import { Alert, AlertDescription } from "@/components/ui/alert";
import { InfoIcon, WarningIcon } from "@phosphor-icons/react/ssr";

export function Flash({ ok, err }: { ok?: string; err?: string }) {
  if (!ok && !err) return null;
  return (
    <Alert className={err ? "border-pastel-red-bg bg-pastel-red-bg" : "border-pastel-green-bg bg-pastel-green-bg"}>
      {err ? (
        <WarningIcon className="size-4 text-pastel-red-text" />
      ) : (
        <InfoIcon className="size-4 text-pastel-green-text" />
      )}
      <AlertDescription className={err ? "text-pastel-red-text" : "text-pastel-green-text"}>
        {err ?? ok}
      </AlertDescription>
    </Alert>
  );
}
