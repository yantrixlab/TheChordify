import { useMemo } from 'react';
import { NavigationContainer, DefaultTheme, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Icon } from '../components/Icons';
import DiscoverScreen from '../screens/DiscoverScreen';
import SearchScreen from '../screens/SearchScreen';
import LibraryScreen from '../screens/LibraryScreen';
import ToolkitScreen from '../screens/ToolkitScreen';
import PremiumScreen from '../screens/PremiumScreen';
import SettingsScreen from '../screens/SettingsScreen';
import ProcessingScreen from '../screens/ProcessingScreen';
import PlayerScreen from '../screens/PlayerScreen';
import UploadScreen from '../screens/UploadScreen';
import TunerScreen from '../screens/TunerScreen';
import MetronomeScreen from '../screens/MetronomeScreen';
import PracticeScreen from '../screens/PracticeScreen';
import ChordDetectorScreen from '../screens/ChordDetectorScreen';
import { useColors, useTheme } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();


// The bottom bar: Discover, Search, My Library, Toolkit, Premium.
const TABS = [
  { name: 'Discover', component: DiscoverScreen, icon: 'discover', label: 'Discover' },
  { name: 'Search', component: SearchScreen, icon: 'search', label: 'Search' },
  { name: 'Library', component: LibraryScreen, icon: 'library', label: 'My Library' },
  { name: 'Toolkit', component: ToolkitScreen, icon: 'toolkit', label: 'Toolkit' },
  { name: 'Premium', component: PremiumScreen, icon: 'premium', label: 'Premium' },
];

const renderIcon = (name) => {
  const TabBarIcon = ({ color }) => <Icon name={name} color={color} size={24} />;
  return TabBarIcon;
};

function Tabs() {
  const colors = useColors();
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarActiveTintColor: colors.accent,
        tabBarInactiveTintColor: colors.mute,
        tabBarLabelStyle: { fontSize: 11.5, fontWeight: '600' },
        lazy: true,
      }}
    >
      {TABS.map((t) => (
        <Tab.Screen key={t.name} name={t.name} component={t.component} options={{ tabBarLabel: t.label, tabBarIcon: renderIcon(t.icon) }} />
      ))}
    </Tab.Navigator>
  );
}

const linking = {
  prefixes: ['chordsuno://'],
  config: { initialRouteName: 'Tabs', screens: { Tabs: '', Player: 'song/:sessionId' } }, // a song opened from a link has Discover under it
};

export default function Navigation() {
  const { colors, scheme } = useTheme();
  const theme = useMemo(
    () => ({
      ...(scheme === 'dark' ? DarkTheme : DefaultTheme),
      colors: { ...(scheme === 'dark' ? DarkTheme : DefaultTheme).colors, background: colors.bg, card: colors.surface, primary: colors.accent, border: colors.line, text: colors.ink },
    }),
    [colors, scheme],
  );
  return (
    <NavigationContainer theme={theme} linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Processing" component={ProcessingScreen} />
        <Stack.Screen name="Player" component={PlayerScreen} />
        {/* the Toolkit's tools and importing a song */}
        <Stack.Screen name="tuner" component={TunerScreen} />
        <Stack.Screen name="metronome" component={MetronomeScreen} />
        <Stack.Screen name="practice" component={PracticeScreen} />
        <Stack.Screen name="chord-detector" component={ChordDetectorScreen} />
        <Stack.Screen name="upload" component={UploadScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
