import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.sistemaelpulpo.app',
  appName: 'Sistema El Pulpo',
  webDir: 'dist',
  server: {
    url: 'https://sistema-el-pulpo.vercel.app',
    cleartext: true
  },
  android: {
    adjustMarginsForEdgeToEdge: 'auto'
  }
};

export default config;
