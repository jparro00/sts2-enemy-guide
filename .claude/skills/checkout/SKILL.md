---
name: checkout
description: List git branches and switch between them
disable-model-invocation: true
allowed-tools: Bash(git branch*), Bash(git checkout*)
---

# Checkout Branch

If the user provides a branch name as an argument, checkout that branch directly: `git checkout $ARGUMENTS`

If no argument is provided:
1. Run `git branch` to list local branches
2. Show the user the list
3. Ask which branch they want to checkout
