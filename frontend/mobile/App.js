import React from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createStackNavigator } from '@react-navigation/stack';
import { Provider } from 'react-redux';
import { PaperProvider } from 'react-native-paper';
import { StatusBar } from 'expo-status-bar';

import { store } from './src/store/store';
import AuthScreen from './src/screens/AuthScreen';
import HomeScreen from './src/screens/HomeScreen';
import TourScreen from './src/screens/TourScreen';
import MerchantScreen from './src/screens/MerchantScreen';
import ProfileScreen from './src/screens/ProfileScreen';

const Stack = createStackNavigator();

export default function App() {
  return (
    <Provider store={store}>
      <PaperProvider>
        <NavigationContainer>
          <StatusBar style="auto" />
          <Stack.Navigator 
            initialRouteName="Home"
            screenOptions={{
              headerStyle: {
                backgroundColor: '#1976d2',
              },
              headerTintColor: '#fff',
              headerTitleStyle: {
                fontWeight: 'bold',
              },
            }}
          >
            <Stack.Screen 
              name="Home" 
              component={HomeScreen} 
              options={{ title: 'Localite' }}
            />
            <Stack.Screen 
              name="Auth" 
              component={AuthScreen} 
              options={{ title: 'Login / Register' }}
            />
            <Stack.Screen 
              name="Tour" 
              component={TourScreen} 
              options={{ title: 'AI Tour Guide' }}
            />
            <Stack.Screen 
              name="Merchant" 
              component={MerchantScreen} 
              options={{ title: 'Merchant Dashboard' }}
            />
            <Stack.Screen 
              name="Profile" 
              component={ProfileScreen} 
              options={{ title: 'My Profile' }}
            />
          </Stack.Navigator>
        </NavigationContainer>
      </PaperProvider>
    </Provider>
  );
} 