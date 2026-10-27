const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

// The website's code that has no browser in it is used as it is, not copied: the chord fingerings (chordShapes.ts) and the
// Toolkit's pitch, chord, tuner-tracking and metronome code (tools/*.ts). Import them as `chordsuno-shared/chordShapes`,
// `chordsuno-shared/tools/pitch`...
const shared = path.resolve(__dirname, '../absolute-ablation/src/lib');
const sharedTools = path.join(shared, 'tools') + path.sep;
const phoneAudio = path.resolve(__dirname, 'src/audio/engine.js');

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
    // The website's files sit outside this folder; the packages they need (Babel's helpers...) are looked for here.
    nodeModulesPaths: [path.resolve(__dirname, 'node_modules')],
    // The tools reach the browser's audio and microphone through "./audio"; on the phone that file is src/audio/engine.js.
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === './audio' && context.originModulePath.startsWith(sharedTools)) {
        return { type: 'sourceFile', filePath: phoneAudio };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
