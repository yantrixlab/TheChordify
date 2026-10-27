import { NavigationContainer, DefaultTheme } from '@react-navigation/native';
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
import ComingSoonScreen from '../screens/ComingSoonScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const theme = { ...DefaultTheme, colors: { ...DefaultTheme.colors, background: colors.bg, card: colors.surface, primary: colors.violet, border: colors.line, text: colors.ink } };

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
  return (
    <Tab.Navigator
      screenOptions={{
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.line, height: 64, paddingBottom: 8, paddingTop: 6 },
        tabBarActiveTintColor: colors.violet,
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
  config: { screens: { Tabs: '', Player: 'song/:sessionId' } },
};

export default function Navigation() {
  return (
    <NavigationContainer theme={theme} linking={linking}>
      <Stack.Navigator screenOptions={{ headerShown: false, animation: 'slide_from_right' }}>
        <Stack.Screen name="Tabs" component={Tabs} />
        <Stack.Screen name="Settings" component={SettingsScreen} />
        <Stack.Screen name="Processing" component={ProcessingScreen} />
        <Stack.Screen name="Player" component={PlayerScreen} />
        {/* the Toolkit's tools; each replaces its placeholder as it is built */}
        <Stack.Screen name="tuner" component={ComingSoonScreen} />
        <Stack.Screen name="metronome" component={ComingSoonScreen} />
        <Stack.Screen name="practice" component={ComingSoonScreen} />
        <Stack.Screen name="chord-detector" component={ComingSoonScreen} />
        <Stack.Screen name="upload" component={ComingSoonScreen} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
