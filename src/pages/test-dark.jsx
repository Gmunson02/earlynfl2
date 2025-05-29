import { useEffect } from "react";

export default function TestDark() {
  useEffect(() => {
    // Log the HTML class list to verify if "dark" is being applied
    console.log("HTML classList:", document.documentElement.classList);
  }, []);

  return (
    <div className="min-h-screen flex items-center justify-center bg-white text-black dark:bg-black dark:text-white transition-colors duration-500">
      <h1 className="text-4xl font-bold">Dark Mode Test</h1>
    </div>
  );
}
