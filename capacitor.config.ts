export interface CapacitorAndroidConfig {
  appId: string;
  appName: string;
  webDir: string;
  bundledWebRuntime: boolean;
  server: {
    androidScheme: 'https';
  };
  android: {
    allowMixedContent: boolean;
    captureInput: boolean;
    webContentsDebuggingEnabled: boolean;
    backgroundColor: string;
  };
}

const config: CapacitorAndroidConfig = {
  appId: 'com.parametricals.technodaw',
  appName: 'Parametric ALS DAW',
  webDir: 'dist',
  bundledWebRuntime: false,
  server: {
    androidScheme: 'https',
  },
  android: {
    allowMixedContent: false,
    captureInput: true,
    webContentsDebuggingEnabled: false,
    backgroundColor: '#0B0D10',
  },
};

export default config;
