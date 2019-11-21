# Trying Theia in Gitpod

[Click here for Gitpod documentation](https://www.gitpod.io/docs/)

## This Pull Request

This is a Pull Request (aka PR, the GitHub term for patch or contribution) that lets you experience using a Cloud-based Theia IDE application, running in a container that contains all dependencies and tools required to develop, test and review.

In this case the PR is from the Theia platform main repository (technically my fork of it, to minimize polution of the upstream repo). The patch changes the Gitpod configuration files so that the Electron version is built and run instead of the default browser version.

This is done to let you experience using a non-cloud application from a cloud workspace, using screen-capture technology (vnc) to send the image to your web browser.

By using both a Cloud and desktop of Theia remotely, you should be able to notice how much nicer the Cloud version is, providing a better UX specially regarding  UI latency.

If everything went well, upon opening this pull request using Gitpod, the patch was already built and the Electron Theia example application started for you.

## Accessing Electron example application

On the status bar at the bottom of the IDE, click on `Ports` - it will open the `Open Ports` View. Then you want to connect to port `6080` by clicking on `Open Browser` next to that port.

This will open a new browser tab that will connect to the `vnc` server running in your Gitpod workspace, permitting you to access the Electron example app built from this PR's sources.

## Discovering review capabilities of Gitpod

In the main Gitpod browser tab, you have:

### Diff View

It's on the left hand side of the IDE. It shows all files that were modified in this PR.

- clicking on a file opens it in Diff mode, highlighting what was changed in the PR
  - if the file type as an associated Languageg Server, the right side of the diff editor will use it, so e.g. to hovering on language elements will provide more information.  
  - the right side of the diff editor permits further editing as well. You get code completion, syntax checks, and so on.

### Terminals

When Gitpod first opens one terminal will be open, in which the example Theia application will be building or maybe pre-built, if someone else has already accessed this particulat PR in Gitpod. You can scroll-up in the terminal to see more logs.

You can open additional terminals, in which you can, if you want, access CLI tools like the CLI git client, toolchain tools and such.

### Pull Request View

Gitpod has a Pull Request view, that one can use to review/comment-on the currently opened PR. Whatever is done in that view is synchromized with GitHub.

The vire is located on the left-side panel - click on the GitHub icon (cat) to expand the view. Clicking on the icon again collapses it. You can resize it, if you think it's not wide enough by default.

