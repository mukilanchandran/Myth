// The paperclip and the tray of files waiting to go with the next message.
import { ActionIcon, Group, Tooltip } from '@mantine/core';
import { IconPaperclip } from '@tabler/icons-react';
import { FileChip } from './ChatMessage';

export function AttachButton({ onFiles, size = 34, variant = 'subtle' }) {
  return (
    <Tooltip label="Attach a file — PDF, notes, images… then say what to do with it (“add this to learning”)">
      <ActionIcon size={size} radius="xl" variant={variant} color="gray" component="label" aria-label="Attach a file">
        <IconPaperclip size={Math.round(size * 0.5)} />
        <input type="file" hidden multiple onChange={(e) => { onFiles(e.target.files); e.target.value = ''; }} />
      </ActionIcon>
    </Tooltip>
  );
}

export function FileTray({ pending, onRemove }) {
  if (!pending?.length) return null;
  return (
    <Group gap={6} px={4} py={2}>
      {pending.map((f) => <FileChip key={f.id} f={f} onRemove={onRemove} />)}
    </Group>
  );
}
