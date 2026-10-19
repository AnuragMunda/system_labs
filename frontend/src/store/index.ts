// Redux store configuration. Single store instance shared across the app; the
// HTTP client reads the access token from the module-level holder (not from
// here) to avoid import cycles, while React components use the typed hooks.
import { configureStore } from "@reduxjs/toolkit";

import { setAuthFailureHandler } from "@/lib/api/http";
import authReducer, { clearAuth } from "./authSlice";
import projectsReducer from "./projectsSlice";
import editorReducer from "./editorSlice";
import simulationsReducer from "./simulationsSlice";

export const store = configureStore({
  reducer: {
    auth: authReducer,
    projects: projectsReducer,
    editor: editorReducer,
    simulations: simulationsReducer,
  },
});

// When a token refresh ultimately fails the HTTP layer clears the session via
// this handler; the dashboard auth guard then redirects to the login screen.
setAuthFailureHandler(() => {
  store.dispatch(clearAuth());
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;
