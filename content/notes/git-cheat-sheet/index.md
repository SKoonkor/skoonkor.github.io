---
title: "Git cheat sheet"
description: "The Git workflow I use day to day, written up for anyone starting out with version control across several projects."
publishDate: "2025-09-22"
tags: ["git", "tools"]
---

A practical reference for using Git with several projects on GitHub. It assumes you already have
git installed and a GitHub account set up with SSH or HTTPS access.

## 1. Starting from GitHub → cloning locally

If you begin a project by creating the repository on GitHub first, the next step is to bring that
empty repository down to your computer. Your local folder is then already connected to the remote,
so you can start adding files and pushing commits immediately.

```bash
# Go to where you want the project folder
cd ~/projects

# Clone the empty repo from GitHub
git clone git@github.com:USERNAME/REPO_NAME.git
cd REPO_NAME

# Add your files, then commit and push
git add .
git commit -m "Initial commit"
git push -u origin main
```

## 2. Starting locally → pushing to GitHub

Sometimes you already have a project folder with files in it. Turn that folder into a repository,
commit its contents, then link it to an empty repo on GitHub. After linking, local and remote stay
in sync.

```bash
cd ~/projects/local_project

# Initialise git
git init

# Add files
git add .
git commit -m "Initial commit"

# Create the empty repo on GitHub, then link it
git remote add origin git@github.com:USERNAME/REPO_NAME.git

# Push
git push -u origin main
```

## 3. Daily workflow, inside any repo folder

Once a project is set up, day-to-day work is tracking changes, committing them, and syncing. This
is the same for every repository you manage.

```bash
git status                  # check what has changed
git add .                   # stage all changes
git commit -m "Message"     # commit a snapshot
git push                    # upload to GitHub
git pull                    # bring down GitHub's changes
```

## 4. Switching between projects

Each project is independent and has its own `.git/` directory, so Git knows which repository it is
working with from the folder you are currently in. To switch projects, navigate into the right
directory — Git applies commands to that project only.

```bash
cd ~/projects/project1      # now working on project 1
git push

cd ~/projects/project2      # now working on project 2
git push
```

## 5. Handy commands

Beyond the basics, these are not part of the minimal daily workflow, but they are useful when you
want to look deeper into a repository or fix a mistake.

```bash
git log --oneline --graph   # view history
git diff                    # see changes not yet staged
git checkout FILE           # discard local changes to a file
git branch                  # list branches
git checkout -b new-branch  # create a branch and switch to it
```

## Tips to keep in mind

- Run `git status` often — it shows exactly what Git is tracking.
- Write meaningful commit messages. "Fix bug in plotting function" beats "Update".
- One project, one repository. This avoids mixing unrelated work.
