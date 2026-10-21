# Electron Native 2.0.0 release

This package is distributed from Git, not from the public npm registry. Its package name is also
`webnat`, so **do not run npm publish here**: that name belongs to the Web SDK release. `private: true`
prevents accidental registry publication while preserving Git installation and prepare/build hooks.

Git tag: **v2.0.0**. Version metadata, WebnatVersion and the lockfile root are all 2.0.0.

```bash
npm ci
npm test
# Requires the adjacent webnat-web/dist/index.js built for 2.0.0:
npm run test:interop
```

Once the release commit and v2.0.0 tag are pushed, the Git-distributed release is available:

```bash
npm install 'git+ssh://git@github.com/auhgnayuo/webnat-electron.git#v2.0.0'
```

There is no additional registry publication command. An optional GitHub Release can be created in the
GitHub UI for v2.0.0 using the 2.0.0 CHANGELOG section. Upgrade the Web SDK at the same time.
