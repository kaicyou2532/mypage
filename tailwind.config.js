/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./views/**/*.ejs", // EJSファイルのパスを指定
  ],
  theme: {
    extend: {},
    fontFamily: {
      nsjp : ['Noto Sans JP', 'sans-serif']
    },
  },
  plugins: [],
}

