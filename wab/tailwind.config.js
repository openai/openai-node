/** @type {import('tailwindcss').Config} */
export default {
  content: [
  './index.html',
  './src/**/*.{js,ts,jsx,tsx}'
],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'Battambang', 'system-ui', 'sans-serif'],
        khmer: ['Battambang', 'sans-serif'],
        'khmer-title': ['Moul', 'serif'],
      },
      colors: {
        navy: {
          50: '#f2f5f9',
          100: '#e1e8f0',
          200: '#c5d3e3',
          300: '#9db5d0',
          400: '#7092ba',
          500: '#4d74a3',
          600: '#385a85',
          700: '#2d486b',
          800: '#1B2A4A', // Primary Navy (darker than 500 usually, but adjusting scale to fit)
          900: '#111a2e',
          950: '#0a0f1a',
        },
        // Adjusting the provided navy #1B2A4A to be the 900 or 800 level for better contrast text, 
        // but prompt asked for it as a base. Let's make a custom scale where 500 is the brand color.
        brandNavy: {
          50: '#eff4ff',
          100: '#dbe6fe',
          200: '#bfd3fe',
          300: '#93bbfd',
          400: '#609afa',
          500: '#3b82f6', // standard blue
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1B2A4A', // The requested Navy
          900: '#17223b',
        },
        // Let's try a more manual scale centered on the requested colors
        customNavy: {
          50: '#f4f6f8',
          100: '#e4e8ed',
          200: '#cdd5df',
          300: '#aab9cc',
          400: '#8098b6',
          500: '#5e7a9e',
          600: '#466082',
          700: '#364b68',
          800: '#1B2A4A', // Using this as the deep primary
          900: '#16223b',
        },
        gold: {
          50: '#fbf8f3',
          100: '#f5efe4',
          200: '#ebdcc3',
          300: '#dfc29a',
          400: '#D4841C', // The requested Gold
          500: '#b56f16',
          600: '#8f5610',
          700: '#6b400c',
          800: '#4a2c08',
          900: '#2b1904',
        }
      }
    },
  },
  plugins: [],
}