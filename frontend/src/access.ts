import { reactive } from "vue";
import { ApiError, accessCode, api } from "./api";

export const codeDialog = reactive({
  open: false,
  error: "",
  resolve: null as null | ((ok: boolean) => void),
});

function askForCode(error = ""): Promise<boolean> {
  codeDialog.error = error;
  codeDialog.open = true;
  return new Promise((resolve) => (codeDialog.resolve = resolve));
}

export function closeCodeDialog(ok: boolean) {
  codeDialog.open = false;
  codeDialog.resolve?.(ok);
  codeDialog.resolve = null;
}

let serverIsOpen: boolean | null = null;

export async function withAccess<T>(action: () => Promise<T>): Promise<T> {
  if (!accessCode.get()) {
    serverIsOpen ??= await api.checkCode("");
    if (!serverIsOpen && !(await askForCode())) {
      throw new ApiError(
        401,
        "no_code",
        "An access code is needed to use this app.",
      );
    }
  }
  try {
    return await action();
  } catch (err) {
    if (err instanceof ApiError && err.status === 401) {
      accessCode.clear();
      if (await askForCode("That access code didn't work. Try again."))
        return action();
    }
    throw err;
  }
}
