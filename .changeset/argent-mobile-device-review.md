---
'@roomote/worker': minor
'@roomote/cloud-agents': minor
---

Pull-request reviews can verify mobile app changes on real iOS simulators and Android emulators. Set `ARGENT_TOOLS_URL` and `ARGENT_AUTH_TOKEN` as deployment environment variables to point sandboxes at an Argent device host on a Mac. Tasks then install the Argent CLI in the background, and reviews of same-repository pull requests that change mobile app behavior install a build of the reviewed commit, exercise the changed screens, and report device defects with screenshots. Pull requests from forks are never built or installed. Deployments without a device host are unaffected.
