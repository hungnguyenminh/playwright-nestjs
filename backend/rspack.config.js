import nodeExternals from 'webpack-node-externals';

/**
 * npm workspaces hoist dependencies to the repo root, so tell the externals
 * plugin to look there too; otherwise rspack tries to bundle node_modules.
 */
export default (options) => ({
  ...options,
  externals: [
    nodeExternals({
      importType: 'module',
      modulesDir: '../node_modules',
      additionalModuleDirs: ['node_modules'],
    }),
    ...options.externals.slice(1),
  ],
});
