// Root Babel config: used by ESLint's @babel/eslint-parser (Babel resolves
// babel.config.js from its root = cwd). Jest and Metro use each workspace's
// own babel.config.js via their per-project rootDir.
module.exports = {
  presets: ['module:@react-native/babel-preset'],
};
