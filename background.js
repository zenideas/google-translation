// Language code mapping
const LANGUAGE_CODES = {
  'bn': 'bn',
  'en': 'en',
  'es': 'es',
  'fr': 'fr',
  'de': 'de',
  'zh-CN': 'zh-CN',
  'ja': 'ja',
  'ko': 'ko',
  'ru': 'ru',
  'ar': 'ar',
  'hi': 'hi',
  'pt': 'pt',
  'it': 'it',
  'tr': 'tr',
  'nl': 'nl'
};

// Default settings
const DEFAULT_SETTINGS = {
  targetLanguage: 'bn', // Bengali as default
  sourceLanguage: 'auto',
  enableContextMenu: true,
  enableVisualFeedback: true
};

let contextMenuExists = false;

// Initialize context menu
async function initializeContextMenu() {
  try {
    const settings = await chrome.storage.local.get(['enableContextMenu']);

    if (settings.enableContextMenu !== false) { // Default to true
      await createOrUpdateContextMenu();
    }
  } catch (error) {
    console.error('Error initializing context menu:', error);
  }
}

async function createOrUpdateContextMenu() {
  try {
    // Get current language settings
    const settings = await chrome.storage.local.get(['targetLanguage']);
    const langCode = settings.targetLanguage || 'bn';
    const langNames = {
      'en': 'English',
      'bn': 'Bengali',
      'es': 'Spanish',
      'fr': 'French',
      'de': 'German',
      'zh-CN': 'Chinese',
      'ja': 'Japanese',
      'ko': 'Korean',
      'ru': 'Russian',
      'ar': 'Arabic',
      'hi': 'Hindi'
    };
    const langName = langNames[langCode] || langCode;
    const menuTitle = `Translate to ${langName}`;

    if (!contextMenuExists) {
      // Create new context menu
      chrome.contextMenus.create({
        id: "translate-text",
        title: menuTitle,
        contexts: ["selection"]
      }, () => {
        if (chrome.runtime.lastError) {
          console.error('Context menu creation error:', chrome.runtime.lastError.message);
          // Try to update if it already exists
          updateExistingContextMenu(menuTitle);
        } else {
          console.log('Context menu created successfully');
          contextMenuExists = true;
        }
      });
    } else {
      // Update existing context menu
      updateExistingContextMenu(menuTitle);
    }
  } catch (error) {
    console.error('Error in createOrUpdateContextMenu:', error);
  }
}

function updateExistingContextMenu(title) {
  chrome.contextMenus.update("translate-text", {
    title: title
  }, () => {
    if (chrome.runtime.lastError) {
      if (chrome.runtime.lastError.message.includes('Cannot find menu item')) {
        // Menu doesn't exist, create it
        contextMenuExists = false;
        createOrUpdateContextMenu();
      } else {
        console.error('Error updating context menu:', chrome.runtime.lastError.message);
      }
    } else {
      contextMenuExists = true;
      console.log('Context menu updated successfully');
    }
  });
}

async function removeContextMenu() {
  try {
    await chrome.contextMenus.removeAll();
    contextMenuExists = false;
    console.log('Context menu removed');
  } catch (error) {
    console.error('Error removing context menu:', error);
  }
}

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "translate-text" && info.selectionText) {
    chrome.storage.local.get(['targetLanguage', 'sourceLanguage'], async (result) => {
      const targetLang = result.targetLanguage || 'bn';
      const sourceLang = result.sourceLanguage || 'auto';

      try {
        // Note: We're NOT sending a "translating..." notification from background
        // The content script will handle its own notifications

        // Translate the text
        const translatedText = await translateText(info.selectionText, targetLang, sourceLang);

        // Copy to clipboard using the active tab
        if (tab && tab.id) {
          await copyToClipboard(tab.id, translatedText);
        } else {
          // Fallback: Send to content script to copy
          chrome.tabs.query({active: true, currentWindow: true}, (tabs) => {
            if (tabs[0] && tabs[0].id) {
              copyToClipboard(tabs[0].id, translatedText);
            }
          });
        }

        // Show success notification
        if (tab && tab.id) {
          let successMessage = `Translation copied to clipboard!`;
          if (targetLang === 'bn') {
            successMessage = `বাংলা অনুবাদ ক্লিপবোর্ডে কপি হয়েছে!`;
          }

          chrome.tabs.sendMessage(tab.id, {
            action: "showNotification",
            message: successMessage,
            type: "success"
          }).catch(() => {
            // Tab might not have content script loaded
          });
        }
      } catch (error) {
        console.error('Translation error:', error);
        if (tab && tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: "showNotification",
            message: `Error: ${error.message}`,
            type: "error"
          }).catch(() => {
            // Tab might not have content script loaded
          });
        }
      }
    });
  }
});

// Helper function to copy text to clipboard using content script
async function copyToClipboard(tabId, text) {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, {
      action: "copyToClipboard",
      text: text
    }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else if (response && response.success) {
        resolve();
      } else {
        reject(new Error(response?.error || 'Failed to copy to clipboard'));
      }
    });
  });
}

// Handle messages from content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  switch (request.action) {
    case "translate":
      handleTranslation(request, sender, sendResponse);
      return true; // Keep message channel open for async response

    case "getSettings":
      chrome.storage.local.get(null, (settings) => {
        sendResponse({...DEFAULT_SETTINGS, ...settings});
      });
      return true;

    case "updateContextMenu":
      createOrUpdateContextMenu();
      sendResponse({ success: true });
      break;

    case "removeContextMenu":
      removeContextMenu();
      sendResponse({ success: true });
      break;

    case "copyToClipboardResult":
      // Handle clipboard copy result from content script
      if (request.success) {
        console.log('Clipboard copy successful');
      } else {
        console.error('Clipboard copy failed:', request.error);
      }
      break;
  }
});

async function handleTranslation(request, sender, sendResponse) {
  try {
    const translatedText = await translateText(
      request.text,
      request.targetLang,
      request.sourceLang || 'auto'
    );

    // Copy to clipboard using the sender tab
    if (sender && sender.tab && sender.tab.id) {
      await copyToClipboard(sender.tab.id, translatedText);

      sendResponse({
        success: true,
        translatedText,
        originalText: request.text
      });
    } else {
      // Fallback: return the text even if clipboard fails
      sendResponse({
        success: true,
        translatedText,
        originalText: request.text,
        clipboardError: 'Could not copy to clipboard, but translation succeeded'
      });
    }
  } catch (error) {
    console.error('Translation error:', error);
    sendResponse({
      success: false,
      error: error.message
    });
  }
}

async function translateText(text, targetLang, sourceLang = 'auto') {
  const validTargetLang = LANGUAGE_CODES[targetLang] || 'bn';

  const apiUrl = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=${sourceLang}&tl=${validTargetLang}&dt=t&q=${encodeURIComponent(text)}`;

  const response = await fetch(apiUrl);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  const data = await response.json();

  // Extract translated text from response
  let translatedText = '';
  if (data && data[0]) {
    data[0].forEach(item => {
      if (item[0]) {
        translatedText += item[0];
      }
    });
  }

  return translatedText || text;
}

// Initialize on install
chrome.runtime.onInstalled.addListener(async () => {
  console.log('Extension installed');

  // Set default settings
  await chrome.storage.local.set(DEFAULT_SETTINGS);

  // Create context menu
  await initializeContextMenu();
});

// Update context menu when settings change
chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.targetLanguage) {
    await createOrUpdateContextMenu();
  }

  if (changes.enableContextMenu !== undefined) {
    if (changes.enableContextMenu.newValue) {
      await createOrUpdateContextMenu();
    } else {
      await removeContextMenu();
    }
  }
});

// Initialize on startup
initializeContextMenu();