import { useState } from "react";
import { X } from "lucide-react";

// Shared deliberate confirm-style rename modal, used by both the admin
// user roster and the Settings-page Family Members section.
export default function RenameModal({ uid, currentName, onSave, onClose, title = "Rename User" }) {
  const [value, setValue] = useState(currentName || "");
  const [saving, setSaving] = useState(false);

  const trimmed = value.trim();
  const unchanged = trimmed === (currentName || "").trim();

  const handleSave = async () => {
    if (!trimmed || unchanged) return;
    setSaving(true);
    await onSave(uid, trimmed);
    setSaving(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-xl shadow-xl w-full max-w-sm">
        <div className="border-b border-gray-200 dark:border-gray-700 px-5 py-3 flex items-center justify-between">
          <h2 className="font-bold text-lg">{title}</h2>
          <button onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium mb-1">Current name</label>
            <p className="text-sm text-gray-500 dark:text-gray-400">{currentName || "—"}</p>
          </div>

          <div>
            <label htmlFor="renameInput" className="block text-sm font-medium mb-1">
              New display name
            </label>
            <input
              id="renameInput"
              type="text"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              maxLength={40}
              autoFocus
              className="w-full p-2 border rounded-lg dark:bg-gray-800 dark:border-gray-600"
            />
          </div>

          <div className="flex gap-2">
            <button
              onClick={onClose}
              className="flex-1 py-2.5 border border-gray-300 dark:border-gray-600 font-semibold rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving || !trimmed || unchanged}
              className="flex-1 py-2.5 bg-green-600 hover:bg-green-700 text-white font-semibold rounded-lg disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save Name"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
