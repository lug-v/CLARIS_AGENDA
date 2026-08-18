"use client";

import { useEffect } from "react";

export default function PwaRegister() {
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("/sw.js").catch((error) => {
        console.error("Não foi possível ativar o modo aplicativo da Clari.", error);
      });
    }
  }, []);

  return null;
}
