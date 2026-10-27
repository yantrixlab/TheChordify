import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { TabIcon } from '../components/Icons';
import HomeScreen from '../screens/HomeScreen';
import LibraryScreen from '../screens/LibraryScreen';
import AccountScreen from '../screens/AccountScreen';
import ProcessingScreen from '../screens/ProcessingScreen';
import PlayerScreen from '../screens/PlayerScreen';
import { colors } from '../theme';

const Stack = createNativeStackNavigator();
const Tab = createBottomTabNavigator();

const theme = { ...DarkTheme, colors: { ...DarkTheme.colors, background: colors.bg, card: colors.bgSoft, primary: colors.violetSoft, border: colors.line } };

function Tabs() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerShown: false,
        tabBarStyle: { backgroundColor: colors.bgSoft, borderTopColor: colors.line },
        tabBarActiveTintColor: '#fff',
        tabBarInactiveTintColor: colors.faint,
        tabBarLabelStyle: { fontSize: 12, fontWeight: '700' },
        tabBarIcon: ({ color }) => <TabIcon name={route.name.toLowerCase()} color={color} />,
      })}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Library" component={LibraryScreen} />
      <Tab.Screen name="Account" component={AccountScreen} />
    </Tab.Navigator>
  );
}

const linking = {
  prefixes: ['chordsuno://'],
  config: { screens: { Tabs: '', Player: 'song/:sessionId' } },
};

const header = { headerTitle: '', headerStyle: { backgroundColor: '#000' }, headerTintColor: '#fff', headerShadowVisible: false };

export default function Navigation() {
  return (
    <NavigationContainer theme={theme} linking={linking}>
      <Stack.Navigator>
        <Stack.Screen name="Tabs" component={Tabs} options={{ headerShown: false }} />
        <Stack.Screen name="Processing" component={ProcessingScreen} options={{ ...header, headerStyle: { backgroundColor: colors.bg } }} />
        <Stack.Screen name="Player" component={PlayerScreen} options={header} />
      </Stack.Navigator>
    </NavigationContainer>
  );
}
