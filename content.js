let isTranslating = false;
let currentSettings = null;
let currentTranslatingNotificationId = null; // Track current translating notification

// Load settings on start
loadSettings();

async function triggerTranslation(text, selection = null) {
  if (isTranslating) return;

  isTranslating = true;

  try {
    const settings = await getSettings();

    // Visual feedback ONLY (no notification)
    if (settings.enableVisualFeedback && selection && selection.rangeCount > 0) {
      highlightSelection(selection, 'translating');
    }

    const response = await chrome.runtime.sendMessage({
      action: "translate",
      text: text,
      targetLang: settings.targetLanguage,
      sourceLang: settings.sourceLanguage
    });

    if (response && response.success) {
      // Success feedback
      if (settings.enableVisualFeedback && selection) {
        highlightSelection(selection, 'success');
        setTimeout(() => clearHighlights(), 2000);
      }

      // Show success message
      let message = '✓ Translation copied to clipboard!';
      if (settings.targetLanguage === 'bn') {
        message = '✓ বাংলা অনুবাদ ক্লিপবোর্ডে কপি হয়েছে!';
      }
      showNotification(message, 'success');
    } else {
      showNotification(`Error: ${response?.error || 'Unknown error'}`, 'error');
      clearHighlights();
    }
  } catch (error) {
    console.error('Translation error:', error);
    showNotification('Translation failed. Please try again.', 'error');
    clearHighlights();
  } finally {
    isTranslating = false;
  }
}

// Highlight selected text
function highlightSelection(selection, state = 'normal') {
  if (!selection || selection.rangeCount === 0) return;

  const range = selection.getRangeAt(0);
  const selectedText = selection.toString().trim();

  if (!selectedText) return;

  // Store the original selection range to restore it later
  const originalStart = range.startContainer;
  const originalStartOffset = range.startOffset;
  const originalEnd = range.endContainer;
  const originalEndOffset = range.endOffset;

  try {
    // Create a temporary span for highlighting
    const span = document.createElement('span');
    span.className = `translation-highlight translation-highlight-${state}`;

    // Try to surround the content with the highlight span
    range.surroundContents(span);

    // Restore the original selection to prevent visual shifting
    const newRange = document.createRange();
    newRange.setStart(originalStart, originalStartOffset);
    newRange.setEnd(originalEnd, originalEndOffset);
    selection.removeAllRanges();
    selection.addRange(newRange);

  } catch (e) {
    // If surroundContents fails (e.g., selection crosses element boundaries)
    console.warn('Could not highlight selection:', e);

    // Alternative: Just add a visual effect without modifying DOM
    if (currentSettings && currentSettings.enableVisualFeedback) {
      // Add a temporary visual indicator that doesn't modify selection
      const tempHighlight = document.createElement('div');
      tempHighlight.className = 'temp-translation-highlight';
      tempHighlight.style.cssText = `
        position: absolute;
        background: rgba(66, 133, 244, 0.2);
        border: 2px solid #4285f4;
        border-radius: 4px;
        pointer-events: none;
        z-index: 10000;
        transition: all 0.3s;
      `;

      // Get bounding rectangle of selection
      const rect = range.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        tempHighlight.style.top = `${rect.top + window.scrollY}px`;
        tempHighlight.style.left = `${rect.left + window.scrollX}px`;
        tempHighlight.style.width = `${rect.width}px`;
        tempHighlight.style.height = `${rect.height}px`;

        document.body.appendChild(tempHighlight);

        // Remove after animation
        setTimeout(() => {
          if (tempHighlight.parentNode) {
            tempHighlight.parentNode.removeChild(tempHighlight);
          }
        }, state === 'translating' ? 2000 : 500);
      }
    }
  }
}

function clearHighlights() {
  document.querySelectorAll('.translation-highlight').forEach(el => {
    const parent = el.parentNode;
    while (el.firstChild) {
      parent.insertBefore(el.firstChild, el);
    }
    parent.removeChild(el);
  });
}

// Handle messages from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "highlightSelection":
      // Find and highlight the text on page
      highlightTextOnPage(request.text);
      break;

    case "showNotification":
      showNotification(request.message, request.type);
      break;

    case "copyToClipboard":
      // Copy text to clipboard
      copyTextToClipboard(request.text)
        .then(() => {
          sendResponse({ success: true });
        })
        .catch(error => {
          sendResponse({ success: false, error: error.message });
        });
      return true; // Keep message channel open
  }
});

// Function to copy text to clipboard
async function copyTextToClipboard(text) {
  try {
    // Try the modern Clipboard API first
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return;
    }

    // Fallback for older browsers or restricted contexts
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    textArea.style.top = '-999999px';
    document.body.appendChild(textArea);
    textArea.focus();
    textArea.select();

    const successful = document.execCommand('copy');
    document.body.removeChild(textArea);

    if (!successful) {
      throw new Error('Failed to copy text');
    }
  } catch (error) {
    throw new Error(`Clipboard copy failed: ${error.message}`);
  }
}

function highlightTextOnPage(text) {
  // Simple text search and highlight (for context menu)
  if (!text || text.length < 2) return;

  const bodyText = document.body.innerHTML;
  const escapedText = text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const regex = new RegExp(`(${escapedText})`, 'gi');

  document.body.innerHTML = document.body.innerHTML.replace(
    regex,
    '<span class="translation-highlight translation-highlight-translating">$1</span>'
  );

  // Scroll to first occurrence
  const firstHighlight = document.querySelector('.translation-highlight');
  if (firstHighlight) {
    firstHighlight.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }

  // Remove highlights after 3 seconds
  setTimeout(() => {
    document.querySelectorAll('.translation-highlight').forEach(el => {
      const parent = el.parentNode;
      while (el.firstChild) {
        parent.insertBefore(el.firstChild, el);
      }
      parent.removeChild(el);
    });
  }, 3000);
}

// Notification system
let notificationCounter = 0;
const activeNotifications = new Set();

function showNotification(message, type = 'info') {
  const id = ++notificationCounter;

  // Remove old notifications
  document.querySelectorAll('.translation-notification').forEach(el => {
    if (el.dataset.id && !activeNotifications.has(parseInt(el.dataset.id))) {
      el.remove();
    }
  });

  // If showing a new notification and there's an existing translating notification, remove it
  if (type !== 'info' && currentTranslatingNotificationId) {
    removeNotification(currentTranslatingNotificationId);
    currentTranslatingNotificationId = null;
  }

  const notification = document.createElement('div');
  notification.className = `translation-notification`;
  notification.dataset.id = id;

  const styles = {
    success: { background: '#4CAF50', icon: '✓' },
    error: { background: '#f44336', icon: '✗' },
    info: { background: '#2196F3', icon: '⏳' },
    warning: { background: '#ff9800', icon: '⚠' }
  };

  const style = styles[type] || styles.info;

  notification.style.cssText = `
    position: fixed;
    top: 70px;
    right: 20px;
    background: ${style.background};
    color: white;
    padding: 12px 20px;
    border-radius: 6px;
    z-index: 1000000;
    font-family: 'Segoe UI', Arial, sans-serif;
    font-size: 14px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    max-width: 300px;
    word-wrap: break-word;
    animation: slideIn 0.3s ease;
    backdrop-filter: blur(10px);
    border: 1px solid rgba(255,255,255,0.1);
  `;

  notification.innerHTML = `
    <div style="display: flex; align-items: center; gap: 8px;">
      <span style="font-size: 16px;">${style.icon}</span>
      <span>${message}</span>
    </div>
  `;

  document.body.appendChild(notification);
  activeNotifications.add(id);

  // Info notifications (translating) should be removed when translation completes
  // Success/error notifications auto-remove after 3 seconds
  if (type === 'info') {
    // Store the ID for later removal
    currentTranslatingNotificationId = id;
  } else {
    setTimeout(() => removeNotification(id), 3000);
  }

  return id;
}

function removeNotification(id) {
  const notification = document.querySelector(`.translation-notification[data-id="${id}"]`);
  if (notification) {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => {
      notification.remove();
      activeNotifications.delete(id);

      // Clear the translating notification ID if it's the one being removed
      if (currentTranslatingNotificationId === id) {
        currentTranslatingNotificationId = null;
      }
    }, 300);
  }
}

// Add CSS animations
if (!document.querySelector('#notification-styles')) {
  const style = document.createElement('style');
  style.id = 'notification-styles';
  style.textContent = `
    @keyframes slideIn {
      from {
        transform: translateX(100%) translateY(-20px);
        opacity: 0;
      }
      to {
        transform: translateX(0) translateY(0);
        opacity: 1;
      }
    }
    @keyframes slideOut {
      from {
        transform: translateX(0) translateY(0);
        opacity: 1;
      }
      to {
        transform: translateX(100%) translateY(-20px);
        opacity: 0;
      }
    }
  `;
  document.head.appendChild(style);
}

// Helper functions
async function getSettings() {
  if (!currentSettings) {
    currentSettings = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
    });
  }
  return currentSettings;
}

async function loadSettings() {
  currentSettings = await getSettings();

  // Update settings when changed
  chrome.storage.onChanged.addListener((changes) => {
    chrome.runtime.sendMessage({ action: "getSettings" }, (settings) => {
      currentSettings = settings;
    });
  });
}

// Keyboard shortcut (Alt+Q)
document.addEventListener('keydown', async (event) => {
  // Check for Alt key (Windows) or Option key (Mac)
  const isAltOrOption = event.altKey;

  // Check if 'q' key is pressed along with Alt/Option
  if (isAltOrOption && event.key.toLowerCase() === 'q') {
    event.preventDefault();
    const selectedText = window.getSelection().toString().trim();
    if (selectedText) {
      await triggerTranslation(selectedText, window.getSelection());
    }
  }
});