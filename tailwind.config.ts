import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}"
  ],
  theme: {
    extend: {
      colors: {
        surface: "#f5f7fb",
        ink: "#14213d",
        accent: "#0f766e",
        danger: "#b91c1c",
        warning: "#92400e",
        ok: "#166534"
      }
    }
  },
  plugins: []
};

export default config;
