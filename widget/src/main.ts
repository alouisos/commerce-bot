import { boot } from "./boot";

// Captured synchronously: currentScript is null once the script has finished executing.
void boot(document, window, document.currentScript);
