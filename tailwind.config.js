// tailwind.config.js
module.exports = {
  content: [
    "./index.html",
    "./src/**/*.{js,jsx,ts,tsx}",
    "./components/**/*.{js,jsx,ts,tsx}",
    "./pages/**/*.{js,jsx,ts,tsx}",
    // Next.js 專案可以用：
    // "./app/**/*.{js,jsx,ts,tsx}", "./pages/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}",
  ],
  safelist: [
    "bg-red-600", "border-red-600", "hover:bg-red-600", "hover:text-white"
  ],
  theme: { extend: {} },
  plugins: [],
};
