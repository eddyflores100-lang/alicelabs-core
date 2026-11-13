import type { CapacitorConfig } from '@capacitor/cli';
const config: CapacitorConfig = {
  appId: 'site.alicelabs.core',
  appName: 'AliceLabs Core',
  webDir: '../web/dist',
  bundledWebRuntime: false,
  backgroundColor: '#0b0e14',
  android: {
    allowMixedContent: false,
    // Never allow wildcard origins or remote code injection into the native shell.
  },
  plugins: {
    LocalNotifications: {
      smallIcon: 'ic_stat_icon_config_sample',
      iconColor: '#8e81d8'
    }
  }
};
export default config;
