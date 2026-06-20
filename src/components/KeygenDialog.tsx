import { useState } from "react";
import {
  Alert,
  Button,
  Code,
  CopyButton,
  Group,
  Modal,
  Stack,
  Text,
  Tooltip,
  ActionIcon,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconCopy,
  IconDeviceFloppy,
  IconKey,
} from "@tabler/icons-react";
import { save } from "@tauri-apps/plugin-dialog";
import { notifications } from "@mantine/notifications";

import { api } from "../api";
import type { KeyPair } from "../types";

interface Props {
  opened: boolean;
  onClose: () => void;
  /** Offer to drop the generated private key straight into the form. */
  onUseKey?: (privateKey: string) => void;
}

function KeyBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <Text size="xs" fw={600} c="dimmed" mb={4}>
        {label}
      </Text>
      <Group gap="xs" wrap="nowrap" align="flex-start">
        <Code block style={{ flex: 1, wordBreak: "break-all" }}>
          {value}
        </Code>
        <CopyButton value={value} timeout={1500}>
          {({ copied, copy }) => (
            <Tooltip label={copied ? "Copied" : "Copy"} withArrow>
              <ActionIcon
                variant="light"
                color={copied ? "green" : "gray"}
                onClick={copy}
                size="lg"
              >
                {copied ? <IconCheck size={18} /> : <IconCopy size={18} />}
              </ActionIcon>
            </Tooltip>
          )}
        </CopyButton>
      </Group>
    </div>
  );
}

export function KeygenDialog({ opened, onClose, onUseKey }: Props) {
  const [pair, setPair] = useState<KeyPair | null>(null);
  const [busy, setBusy] = useState(false);

  async function generate() {
    setBusy(true);
    try {
      setPair(await api.generateKeypair());
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setPair(null);
    onClose();
  }

  async function saveToFile() {
    if (!pair) return;
    const path = await save({
      title: "Save your key file",
      defaultPath: "occ-companion-identity.txt",
      filters: [{ name: "age identity", extensions: ["txt", "key", "age"] }],
    });
    if (!path) return;
    // Standard age identity file: public key as a comment + the secret key.
    const content =
      `# OCC Companion key pair\n` +
      `# public key: ${pair.publicKey}\n` +
      `${pair.privateKey}\n`;
    try {
      await api.saveTextFile(path, content, true);
      notifications.show({
        color: "green",
        icon: <IconCheck size={18} />,
        title: "Key saved",
        message: "Keep this file somewhere safe — it is your only way to decrypt.",
        autoClose: 3500,
      });
    } catch (e) {
      notifications.show({
        color: "red",
        icon: <IconAlertTriangle size={18} />,
        title: "Could not save the key",
        message: String(e),
        autoClose: 5000,
      });
    }
  }

  return (
    <Modal
      opened={opened}
      onClose={close}
      title="Generate a key pair"
      size="lg"
      centered
    >
      <Stack>
        <Text size="sm" c="dimmed">
          Your <b>public key</b> goes to the OCC so your exports can be
          encrypted for you. Your <b>private key</b> stays on this device and is
          the only thing that can decrypt them.
        </Text>

        {!pair ? (
          <Button
            leftSection={<IconKey size={18} />}
            onClick={generate}
            loading={busy}
            mt="xs"
          >
            Generate a new key pair
          </Button>
        ) : (
          <>
            <KeyBlock label="PUBLIC KEY — paste this into the OCC" value={pair.publicKey} />
            <KeyBlock label="PRIVATE KEY — keep this secret" value={pair.privateKey} />

            <Alert
              color="orange"
              icon={<IconAlertTriangle size={18} />}
              variant="light"
            >
              Save the private key somewhere safe now. If you lose it, your
              encrypted exports can never be recovered. It is never sent
              anywhere.
            </Alert>

            <Group justify="space-between">
              <Button
                variant="light"
                leftSection={<IconDeviceFloppy size={18} />}
                onClick={saveToFile}
              >
                Save key to file
              </Button>
              <Group gap="sm">
                {onUseKey && (
                  <Button
                    variant="subtle"
                    onClick={() => {
                      onUseKey(pair.privateKey);
                      close();
                    }}
                  >
                    Use in connection
                  </Button>
                )}
                <Button variant="default" onClick={close}>
                  Done
                </Button>
              </Group>
            </Group>
          </>
        )}
      </Stack>
    </Modal>
  );
}
