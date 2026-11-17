// The game's text formatter, for tools/l10n/check.mjs formatter.
//
//   dotnet run --project tools/l10n/oracle -- probe <cultures.json> <out.json>
//       Per culture: the plural form SmartFormat picks for -10..200 and 0.5, 1.5, 2.5 with 2..6 forms (null: the
//       game fails), and how {X}, {X:n()} and {X:abs()} write numbers
//   dotnet run --project tools/l10n/oracle -- format <requests.json> <out.json>
//       requests: [{ culture, template, vars }]; out: [{ text } | { error }], in the same order
//
// SmartFormat and its formatters are the game's (the DLL it ships, added in LocManager.LoadLocFormatters'
// order). The game's own formatters need its runtime (DynamicVar, RunManager, LocManager.Instance), so they are
// rewritten below for the plain values the site's GameVars give, from the decompiled source
// (src/Core/Localization/Formatters); none of them depends on the language except "n" and "abs", whose culture
// is the language's, as in the game.
using System.Globalization;
using System.Text.Json;
using SmartFormat;
using SmartFormat.Core.Extensions;
using SmartFormat.Core.Formatting;
using SmartFormat.Extensions;

static class Program
{
    static int Main(string[] args)
    {
        if (args.Length != 3 || (args[0] != "probe" && args[0] != "format"))
        {
            Console.Error.WriteLine("usage: oracle probe <cultures.json> <out.json> | format <requests.json> <out.json>");
            return 2;
        }
        SmartFormatter sf = GameFormatter();
        using JsonDocument input = JsonDocument.Parse(File.ReadAllText(args[1]));
        using FileStream outFile = File.Create(args[2]);
        using Utf8JsonWriter w = new(outFile, new JsonWriterOptions { Indented = true, Encoder = System.Text.Encodings.Web.JavaScriptEncoder.UnsafeRelaxedJsonEscaping });
        if (args[0] == "probe") Probe(sf, input.RootElement, w);
        else Format(sf, input.RootElement, w);
        return 0;
    }

    // LocManager.LoadLocFormatters, with the game's formatters as rewritten below
    static SmartFormatter GameFormatter()
    {
        SmartFormatter sf = new();
        ListFormatter list = new();
        sf.AddExtensions(list, new DictionarySource(), new ValueTupleSource(), new ReflectionSource(), new DefaultSource());
        sf.AddExtensions(list, new PluralLocalizationFormatter(), new ConditionalFormatter(), new ChooseFormatter(), new SubStringFormatter(), new IsMatchFormatter(),
            new LocaleNumberFormatter(), new DefaultFormatter(), new AbsoluteValueFormatter(), new EnergyIconsFormatter(), new StarIconsFormatter(),
            new HighlightDifferencesFormatter("diff"), new HighlightDifferencesFormatter("inverseDiff"), new PercentFormatter("percentMore", more: true),
            new PercentFormatter("percentLess", more: false), new ShowIfUpgradedFormatter());
        return sf;
    }

    static readonly decimal[] ProbeNumbers = { 0m, 5m, 999m, 1000m, 12345m, 1234567m, -1234m, 1.5m, -0.25m };
    public const int PluralFrom = -10, PluralTo = 200;
    static readonly decimal[] PluralFractions = { 0.5m, 1.5m, 2.5m };

    static void Probe(SmartFormatter sf, JsonElement cultures, Utf8JsonWriter w)
    {
        w.WriteStartObject();
        foreach (JsonElement c in cultures.EnumerateArray())
        {
            string name = c.GetString()!;
            CultureInfo culture = CultureInfo.GetCultureInfo(name);
            w.WriteStartObject(name);
            w.WriteString("twoLetter", culture.TwoLetterISOLanguageName);
            foreach (string f in new[] { "{X}", "{X:n()}", "{X:abs()}" })
            {
                w.WriteStartObject(f);
                foreach (decimal n in ProbeNumbers) w.WriteString(n.ToString(CultureInfo.InvariantCulture), sf.Format(culture, f, new Dictionary<string, object> { ["X"] = n }));
                w.WriteEndObject();
            }
            w.WriteStartObject("plural");
            for (int forms = 2; forms <= 6; forms++)
            {
                string words = string.Join("|", Enumerable.Range(0, forms).Select(i => $"w{i}"));
                w.WriteStartArray(forms.ToString(CultureInfo.InvariantCulture));
                foreach (decimal n in Enumerable.Range(PluralFrom, PluralTo - PluralFrom + 1).Select(i => (decimal)i).Concat(PluralFractions))
                {
                    string got;
                    try { got = sf.Format(culture, "{X:plural:" + words + "}", new Dictionary<string, object> { ["X"] = n }); }
                    catch (Exception e) { got = "error: " + e.GetType().Name; }
                    if (got.StartsWith("w", StringComparison.Ordinal) && int.TryParse(got.AsSpan(1), out int i)) w.WriteNumberValue(i);
                    else if (got.StartsWith("error", StringComparison.Ordinal)) w.WriteNullValue();
                    else w.WriteStringValue(got);
                }
                w.WriteEndArray();
            }
            w.WriteEndObject();
            w.WriteEndObject();
        }
        w.WriteEndObject();
    }

    static void Format(SmartFormatter sf, JsonElement requests, Utf8JsonWriter w)
    {
        w.WriteStartArray();
        foreach (JsonElement r in requests.EnumerateArray())
        {
            CultureInfo culture = CultureInfo.GetCultureInfo(r.GetProperty("culture").GetString()!);
            Dictionary<string, object> vars = new();
            foreach (JsonProperty p in r.GetProperty("vars").EnumerateObject()) vars[p.Name] = Value(p.Value);
            w.WriteStartObject();
            try { w.WriteString("text", sf.Format(culture, r.GetProperty("template").GetString()!, vars)); }
            catch (Exception e) { w.WriteString("error", $"{e.GetType().Name}: {e.Message}"); }
            w.WriteEndObject();
        }
        w.WriteEndArray();
    }

    // The game's values are decimals (DynamicVar.BaseValue) and bools; strings name an energy color or an upgrade state
    static object Value(JsonElement v) => v.ValueKind switch
    {
        JsonValueKind.Number => v.GetDecimal(),
        JsonValueKind.True => true,
        JsonValueKind.False => false,
        _ => v.GetString() ?? "",
    };
}

/// <summary>LocaleNumberFormatter: numbers as N0 (or the given .NET format) in the language's culture.</summary>
sealed class LocaleNumberFormatter : IFormatter
{
    public string Name { get => "n"; set => throw new NotSupportedException(); }
    public bool CanAutoDetect { get; set; } = true;
    public bool TryEvaluateFormat(IFormattingInfo info)
    {
        object v = info.CurrentValue!;
        if (v is not (int or uint or long or ulong or decimal or float or double)) return false;
        string format = string.IsNullOrEmpty(info.Format?.RawText) ? "N0" : info.Format!.RawText;
        info.Write(((IFormattable)v).ToString(format, Culture(info)));
        return true;
    }
    public static CultureInfo Culture(IFormattingInfo info) => info.FormatDetails.Provider as CultureInfo ?? CultureInfo.InvariantCulture;
}

/// <summary>AbsoluteValueFormatter: decimals in the language's culture.</summary>
sealed class AbsoluteValueFormatter : IFormatter
{
    public string Name { get => "abs"; set => throw new NotSupportedException(); }
    public bool CanAutoDetect { get; set; }
    public bool TryEvaluateFormat(IFormattingInfo info)
    {
        if (info.CurrentValue is not decimal d) return false;
        info.Write(Math.Abs(d).ToString(LocaleNumberFormatter.Culture(info)));
        return true;
    }
}

/// <summary>EnergyIconsFormatter: a count (or a color name with the count as the option); the color from energyPrefix.</summary>
sealed class EnergyIconsFormatter : IFormatter
{
    public string Name { get => "energyIcons"; set => throw new NotSupportedException(); }
    public bool CanAutoDetect { get; set; }
    public bool TryEvaluateFormat(IFormattingInfo info)
    {
        string? prefix = null;
        int count;
        switch (info.CurrentValue)
        {
            case decimal d: count = (int)d; break;
            case int i: count = i; break;
            case string s:
                if (!int.TryParse(info.FormatterOptions, out count)) return false;
                prefix = s;
                break;
            default: throw new FormattingException(info.Format, $"energyIcons: {info.CurrentValue}", 0);
        }
        if ((string.IsNullOrEmpty(prefix) || prefix == "colorless") && info is FormattingInfo fi)
        {
            FormattingInfo root = fi;
            while (root.Parent != null) root = root.Parent;
            if (root.CurrentValue is Dictionary<string, object> d && d.TryGetValue("energyPrefix", out object? p) && p is string ps) prefix = ps;
        }
        if (string.IsNullOrEmpty(prefix)) prefix = "colorless";
        string icon = "[img]res://images/packed/sprite_fonts/" + prefix + "_energy_icon.png[/img]";
        info.Write(count > 0 && count < 5 ? string.Concat(Enumerable.Repeat(icon, count)) : $"{count}{icon}");
        return true;
    }
}

/// <summary>StarIconsFormatter.</summary>
sealed class StarIconsFormatter : IFormatter
{
    public string Name { get => "starIcons"; set => throw new NotSupportedException(); }
    public bool CanAutoDetect { get; set; }
    public bool TryEvaluateFormat(IFormattingInfo info)
    {
        int n = info.CurrentValue switch { decimal d => (int)d, int i => i, _ => throw new FormattingException(info.Format, $"starIcons: {info.CurrentValue}", 0) };
        const string icon = "[img]res://images/packed/sprite_fonts/star_icon.png[/img]";
        info.Write(n > 0 && n < 5 ? string.Concat(Enumerable.Repeat(icon, n)) : $"{n}{icon}");
        return true;
    }
}

/// <summary>diff / inverseDiff: DynamicVar.ToHighlightedString, the shown value (invariant) with no change to highlight.</summary>
sealed class HighlightDifferencesFormatter(string name) : IFormatter
{
    public string Name { get => name; set => throw new NotSupportedException(); }
    public bool CanAutoDetect { get; set; }
    public bool TryEvaluateFormat(IFormattingInfo info)
    {
        if (info.CurrentValue is not decimal d) return false;
        info.Write(((int)d).ToString(CultureInfo.InvariantCulture));
        return true;
    }
}

/// <summary>percentMore / percentLess: (v - 1) x 100 / (1 - v) x 100, invariant.</summary>
sealed class PercentFormatter(string name, bool more) : IFormatter
{
    public string Name { get => name; set => throw new NotSupportedException(); }
    public bool CanAutoDetect { get; set; }
    public bool TryEvaluateFormat(IFormattingInfo info)
    {
        decimal v;
        try { v = Convert.ToDecimal(info.CurrentValue, CultureInfo.InvariantCulture); }
        catch (Exception e) when (e is FormatException or InvalidCastException) { return false; }
        info.Write(Convert.ToInt32(more ? (v - 1m) * 100m : (1m - v) * 100m).ToString(CultureInfo.InvariantCulture));
        return true;
    }
}

/// <summary>show: IfUpgradedVar, here its display as a string ("normal" | "upgraded").</summary>
sealed class ShowIfUpgradedFormatter : IFormatter
{
    public string Name { get => "show"; set => throw new NotSupportedException(); }
    public bool CanAutoDetect { get; set; }
    public bool TryEvaluateFormat(IFormattingInfo info)
    {
        if (info.CurrentValue is not string display) return false;
        IList<SmartFormat.Core.Parsing.Format>? parts = info.Format?.Split('|');
        if (parts == null || parts.Count > 2) throw new FormattingException(info.Format, "show: 1 or 2 options", 0);
        if (display == "upgraded") info.FormatAsChild(parts[0], info.CurrentValue);
        else if (parts.Count > 1) info.FormatAsChild(parts[1], info.CurrentValue);
        return true;
    }
}
