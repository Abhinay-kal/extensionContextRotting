import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        ck: {
          green: '#18A957',
          amber: '#E0A400',
          red: '#D64545',
          slate: '#1D2330'
        }
      }
    }
  },
  corePlugins: {
    preflight: false
  }
};

export default config;
