const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The website's chord fingerings (absolute-ablation/src/lib/chordShapes.ts) have no browser code in them, so the app uses that
// very file instead of keeping a copy: `import ... from 'chordsuno-shared/chordShapes'`.
const shared = path.resolve(__dirname, '../absolute-ablation/src/lib');

/**
 * Metro configuration
 * https://reactnative.dev/docs/metro
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [shared],
  resolver: {
    extraNodeModules: { 'chordsuno-shared': shared },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
