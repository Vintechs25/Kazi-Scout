import { useEffect, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Mail,
  RotateCw,
  Trash2,
} from "lucide-react";
import {
  getGetSettingsQueryKey,
  useDisconnectGmail,
  type GetSettingsQueryResult,
  useRemoveAiProvider,
  useSaveAiProvider,
  useSaveGmailOAuthConfig,
  useTestAiProvider,
} from "@workspace/api-client-react";

type SettingsData = GetSettingsQueryResult;
type ProviderConnection = SettingsData["providers"][number];
type AiProvider = "openai" | "gemini";

function readableError(error: unknown): string {
  return error instanceof Error ? error.message : "The request failed. Try again.";
}

function statusClass(status: ProviderConnection["status"]): string {
  if (status === "CONNECTED") return "badge badge-green";
  if (status === "ERROR") return "badge badge-red";
  return "badge badge-amber";
}

function AiProviderCard({
  provider,
  connection,
}: {
  provider: AiProvider;
  connection: ProviderConnection;
}) {
  const queryClient = useQueryClient();
  const save = useSaveAiProvider();
  const test = useTestAiProvider();
  const remove = useRemoveAiProvider();
  const [apiKey, setApiKey] = useState("");
  const [selectedModel, setSelectedModel] = useState(connection.model ?? "");
  const [testMessage, setTestMessage] = useState("");
  const [removeMessage, setRemoveMessage] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelsError, setModelsError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Sync selectedModel if connection.model changes and we don't have one selected yet
  useEffect(() => {
    if (connection.model && !selectedModel) {
      setSelectedModel(connection.model);
    }
  }, [connection.model, selectedModel]);

  const fetchModels = async (keyToUse?: string) => {
    const key = (keyToUse !== undefined ? keyToUse : apiKey).trim();
    if (!key && !connection.configured) {
      setModelsError("Please enter an API key first.");
      return;
    }

    setLoadingModels(true);
    setModelsError("");
    try {
      const response = await fetch(`/api/settings/providers/${provider}/models`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ apiKey: key || undefined }),
      });
      if (!response.ok) {
        const resJson = await response.json().catch(() => null);
        const errorText = resJson?.error || (await response.text().catch(() => "")) || "Failed to fetch models";
        setModelsError(errorText);
        setModels([]);
      } else {
        const data = await response.json();
        const fetched: string[] = data.models || [];
        setModels(fetched);
        if (fetched.length > 0) {
          if (!selectedModel || !fetched.includes(selectedModel)) {
            setSelectedModel(fetched[0]);
          }
        }
      }
    } catch {
      setModelsError("Failed to fetch models. Check connection.");
      setModels([]);
    } finally {
      setLoadingModels(false);
    }
  };

  const filteredModels = models.filter((m) =>
    m.toLowerCase().includes(searchQuery.toLowerCase()),
  );

  const saveProvider = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    const modelValue = String(values.get("model") || selectedModel || "").trim();
    const apiKeyValue = String(values.get("apiKey") || apiKey || "").trim();

    save.mutate(
      {
        provider,
        data: {
          apiKey: apiKeyValue,
          model: modelValue,
        },
      },
      {
        onSuccess: () => {
          form.reset();
          setApiKey("");
          setTestMessage("");
          void queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
      },
    );
  };

  const testProvider = () => {
    setTestMessage("");
    test.mutate(
      { provider },
      {
        onSuccess: (result) => {
          setTestMessage(result.message);
          void queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (error) => setTestMessage(readableError(error)),
      },
    );
  };

  const removeProvider = () => {
    if (!confirm(`Remove the saved ${provider} API key from this app?`)) return;
    setRemoveMessage("");
    remove.mutate(
      { provider },
      {
        onSuccess: () => {
          setRemoveMessage("Saved credentials removed.");
          setTestMessage("");
          setSelectedModel("");
          setModels([]);
          void queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (error) => setRemoveMessage(readableError(error)),
      },
    );
  };

  return (
    <section className="panel" data-testid={`card-provider-${provider}`}>
      <div className="panel-head">
        <div>
          <div className="panel-title" style={{ textTransform: "capitalize" }}>
            {provider}
          </div>
          <div className="field-hint" style={{ marginTop: 4 }}>
            {connection.detail}
          </div>
        </div>
        <span
          className={statusClass(connection.status)}
          data-testid={`status-provider-${provider}`}
        >
          {connection.status.replaceAll("_", " ")}
        </span>
      </div>
      <div className="panel-body">
        <form onSubmit={saveProvider} className="form-grid">
          <label className="form-item">
            <span className="label">API key</span>
            <div style={{ display: "flex", gap: 8 }}>
              <input
                className="field"
                type="password"
                name="apiKey"
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  if (modelsError) setModelsError("");
                }}
                autoComplete="new-password"
                required
                minLength={8}
                maxLength={2000}
                placeholder={connection.configured ? "Enter new key to update..." : "Paste API key..."}
                data-testid={`input-api-key-${provider}`}
                style={{ flex: 1 }}
              />
              <button
                type="button"
                className="btn"
                onClick={() => fetchModels(apiKey)}
                disabled={loadingModels || (!apiKey && !connection.configured)}
                title="Fetch compatible models for this key"
                data-testid={`button-fetch-models-${provider}`}
              >
                {loadingModels ? "Loading..." : "Get Models"}
              </button>
            </div>
            <span className="field-hint">
              Encrypted before local storage. The saved value is never shown again.
            </span>
          </label>
          <label className="form-item">
            <span className="label">Model ID</span>
            {models.length > 0 ? (
              <>
                {models.length > 5 && (
                  <input
                    className="field"
                    type="text"
                    placeholder="Search models..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ marginBottom: 8 }}
                  />
                )}
                <select
                  className="field select"
                  name="model"
                  value={selectedModel}
                  onChange={(e) => setSelectedModel(e.target.value)}
                  required
                  data-testid={`input-model-${provider}`}
                  style={{ width: "100%" }}
                >
                  <option value="">Select a compatible model...</option>
                  {filteredModels.map((model) => (
                    <option key={model} value={model}>
                      {model}
                    </option>
                  ))}
                </select>
              </>
            ) : (
              <input
                className="field"
                type="text"
                name="model"
                value={selectedModel}
                onChange={(e) => setSelectedModel(e.target.value)}
                required
                maxLength={160}
                data-testid={`input-model-${provider}`}
                placeholder={
                  provider === "gemini"
                    ? "e.g. gemini-1.5-flash or gemini-2.0-flash"
                    : "e.g. gpt-4o-mini or gpt-4o"
                }
              />
            )}
            <span className="field-hint" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {loadingModels && <span>Loading available compatible models...</span>}
              {modelsError && (
                <span style={{ color: "hsl(var(--destructive))" }}>{modelsError}</span>
              )}
              {models.length > 0 && !loadingModels && !modelsError && (
                <span>
                  Found {models.length} compatible model{models.length === 1 ? "" : "s"}.{" "}
                  <button
                    type="button"
                    className="btn-quiet"
                    style={{ padding: 0, fontSize: 11 }}
                    onClick={() => setModels([])}
                  >
                    Hide list
                  </button>
                </span>
              )}
              {!loadingModels && !modelsError && models.length === 0 && connection.configured && (
                <span>
                  Configured: <strong>{connection.model}</strong>.{" "}
                  <button
                    type="button"
                    className="btn-quiet"
                    style={{ padding: 0, fontSize: 11 }}
                    onClick={() => fetchModels("")}
                  >
                    Load available models
                  </button>
                </span>
              )}
              {!loadingModels && !modelsError && models.length === 0 && !connection.configured && (
                <span>Enter your API key and click "Get Models" to view compatible models.</span>
              )}
            </span>
          </label>
          <div className="form-item full" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={save.isPending}
              data-testid={`button-save-${provider}`}
            >
              <KeyRound size={14} />
              {save.isPending ? "Saving…" : "Save credentials"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={testProvider}
              disabled={!connection.configured || test.isPending}
              data-testid={`button-test-${provider}`}
            >
              <RotateCw size={14} />
              {test.isPending ? "Testing…" : "Test connection"}
            </button>
            {connection.configured && (
              <button
                className="btn btn-danger"
                type="button"
                onClick={removeProvider}
                disabled={remove.isPending}
                data-testid={`button-remove-${provider}`}
              >
                <Trash2 size={14} />
                Remove
              </button>
            )}
          </div>
        </form>
        {(save.isError || testMessage || removeMessage) && (
          <p
            className="field-hint"
            style={{ color: "hsl(var(--destructive))", marginBottom: 0 }}
            data-testid={`status-message-${provider}`}
          >
            {save.isError
              ? readableError(save.error)
              : testMessage || removeMessage}
          </p>
        )}
        {save.isSuccess && !save.isPending && (
          <p className="field-hint" data-testid={`status-saved-${provider}`}>
            Credentials saved locally. Test the connection to verify the model.
          </p>
        )}
      </div>
    </section>
  );
}

function GmailCard({
  connection,
  redirectUri,
}: {
  connection: ProviderConnection;
  redirectUri: string;
}) {
  const queryClient = useQueryClient();
  const save = useSaveGmailOAuthConfig();
  const disconnect = useDisconnectGmail();
  const [message, setMessage] = useState("");
  const [copied, setCopied] = useState(false);

  const saveConfig = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const values = new FormData(form);
    save.mutate(
      {
        data: {
          clientId: String(values.get("clientId") ?? ""),
          clientSecret: String(values.get("clientSecret") ?? ""),
        },
      },
      {
        onSuccess: () => {
          form.reset();
          setMessage("Google OAuth credentials saved.");
          void queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (error) => setMessage(readableError(error)),
      },
    );
  };

  const startConnection = () => {
    const base = new URL(import.meta.env.BASE_URL, window.location.origin);
    window.location.assign(new URL("api/integrations/gmail/connect", base).toString());
  };

  const removeConnection = () => {
    if (!confirm("Disconnect Gmail and remove its saved OAuth credentials?")) return;
    disconnect.mutate(
      undefined,
      {
        onSuccess: (result) => {
          setMessage(result.message);
          void queryClient.invalidateQueries({ queryKey: getGetSettingsQueryKey() });
        },
        onError: (error) => setMessage(readableError(error)),
      },
    );
  };

  const copyRedirectUri = async () => {
    try {
      await navigator.clipboard.writeText(redirectUri);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setMessage("Copy failed. Select and copy the redirect URI manually.");
    }
  };

  return (
    <section className="panel" data-testid="card-provider-gmail">
      <div className="panel-head">
        <div>
          <div className="panel-title">Gmail OAuth</div>
          <div className="field-hint" style={{ marginTop: 4 }}>
            {connection.detail}
          </div>
        </div>
        <span className={statusClass(connection.status)} data-testid="status-provider-gmail">
          {connection.status.replaceAll("_", " ")}
        </span>
      </div>
      <div className="panel-body">
        {connection.connectedEmail && (
          <div className="connection" style={{ paddingTop: 0 }}>
            <span className="connection-name">Connected account</span>
            <span className="connection-detail" data-testid="text-gmail-account">
              {connection.connectedEmail}
            </span>
          </div>
        )}
        <div className="notice" style={{ marginBottom: 16 }}>
          Gmail uses read-only access. This app does not send, delete, or modify mail.
          The OAuth client ID and secret are stored encrypted on this machine.
        </div>
        <form onSubmit={saveConfig} className="form-grid">
          <label className="form-item">
            <span className="label">Google OAuth client ID</span>
            <input
              className="field"
              type="text"
              name="clientId"
              defaultValue={connection.clientId ?? ""}
              required
              minLength={8}
              maxLength={500}
              autoComplete="off"
              data-testid="input-gmail-client-id"
            />
          </label>
          <label className="form-item">
            <span className="label">Google OAuth client secret</span>
            <input
              className="field"
              type="password"
              name="clientSecret"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={2000}
              data-testid="input-gmail-client-secret"
            />
            <span className="field-hint">
              The secret is never returned by the API. Enter it again when updating the OAuth client.
            </span>
          </label>
          <div className="form-item full">
            <span className="label">Authorized redirect URI</span>
            <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
              <code
                className="field"
                style={{ flex: 1, overflowWrap: "anywhere", height: "auto", minHeight: 38 }}
                data-testid="text-gmail-redirect-uri"
              >
                {redirectUri}
              </code>
              <button
                className="btn"
                type="button"
                onClick={copyRedirectUri}
                data-testid="button-copy-gmail-redirect"
              >
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <span className="field-hint">
              Register this exact URI in your Google Cloud OAuth web client and enable the Gmail API.
            </span>
          </div>
          <div className="form-item full" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              className="btn btn-primary"
              type="submit"
              disabled={save.isPending}
              data-testid="button-save-gmail"
            >
              <KeyRound size={14} />
              {save.isPending ? "Saving…" : "Save OAuth credentials"}
            </button>
            <button
              className="btn"
              type="button"
              onClick={startConnection}
              disabled={!connection.configured}
              data-testid="button-connect-gmail"
            >
              <Mail size={14} />
              Connect Gmail
              <ExternalLink size={13} />
            </button>
            {connection.configured && (
              <button
                className="btn btn-danger"
                type="button"
                onClick={removeConnection}
                disabled={disconnect.isPending}
                data-testid="button-disconnect-gmail"
              >
                <Trash2 size={14} />
                {disconnect.isPending ? "Disconnecting…" : "Disconnect"}
              </button>
            )}
          </div>
        </form>
        {message && (
          <p className="field-hint" data-testid="status-message-gmail">
            {message}
          </p>
        )}
        {save.isError && (
          <p className="field-hint" style={{ color: "hsl(var(--destructive))" }}>
            {readableError(save.error)}
          </p>
        )}
      </div>
    </section>
  );
}

export function SettingsConnections({
  settings,
}: {
  settings: SettingsData;
}) {
  const openai = settings.providers.find((provider) => provider.provider === "openai");
  const gemini = settings.providers.find((provider) => provider.provider === "gemini");
  const gmail = settings.providers.find((provider) => provider.provider === "gmail");

  if (!openai || !gemini || !gmail) {
    return (
      <div className="notice" data-testid="status-provider-list-incomplete">
        Provider status is incomplete. Refresh the page to reload settings.
      </div>
    );
  }

  return (
    <section style={{ display: "grid", gap: 14, marginBottom: 14 }}>
      <div>
        <h2 className="panel-title" style={{ marginBottom: 6 }}>AI providers</h2>
        <p className="page-sub" style={{ margin: 0 }}>
          Enter your own API credentials. CV parsing is available only after a provider is configured.
        </p>
      </div>
      <AiProviderCard provider="openai" connection={openai} />
      <AiProviderCard provider="gemini" connection={gemini} />
      <div>
        <h2 className="panel-title" style={{ marginBottom: 6 }}>Mailbox connection</h2>
        <p className="page-sub" style={{ margin: 0 }}>
          Connect Gmail only if you want to authorize this app to read mail.
        </p>
      </div>
      <GmailCard connection={gmail} redirectUri={settings.gmailRedirectUri} />
    </section>
  );
}
