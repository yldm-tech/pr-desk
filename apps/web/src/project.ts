export const projectRepository = "https://github.com/yldm-tech/pr-desk";
const version = import.meta.env.VITE_APP_VERSION || "dev";
export const projectVersion = version === "dev" ? "dev" : `v${version}`;
