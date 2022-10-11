# Stepdocs (prototype)

help me stepdocs I'm stuck.

## Note: This software is Prototype

There will be no docs about how to use or how to contribute.  
I will rewrite this software soon.

## Example
> Navigation in sidebar  

[example](https://github.com/step-docs/stepdocs-example) -> [wiki](https://github.com/step-docs/stepdocs-example/wiki) (general purpose)  
[example-algorithm](https://github.com/step-docs/stepdocs-example-algorithm) -> [wiki](https://github.com/step-docs/stepdocs-example-algorithm/wiki) (example repo to describe an algorithm)   

## Tasks
> Plan: able to generate github wiki and show commit as a step  
> (I'm not finallize about generated format yet)
+ [x] Parse output of `git`
+ [x] Filter only commit that start with `[<SYMVER>] <STEP NAME>`
+ [x] Show diff on each step (commit)
+ [x] Normalize diff
+ [x] Generate markdown from data
+ [x] Output for github wiki
+ [ ] Generate home page
+ [ ] Merge commit level eg. 2 mean merge files of step 1.x into 1.md
+ [ ] Can't remember

## Not planned on prototype
+ Any optimization
+ CLI (hardcode only)
+ A utility to help manipulate git repo (eg. bulk rename commits)
+ Handle more file type (supported at this moment [`.js`, `.ts`, `.sh`, `.md`])
