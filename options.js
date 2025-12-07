document.addEventListener('DOMContentLoaded', () => {
  // Load saved settings
  loadSettings();

  // Save settings
  document.getElementById('save').addEventListener('click', saveSettings);

  // Update language display when target language changes
  document.getElementById('targetLanguage').addEventListener('change', updateLanguagePreview);
});

async function loadSettings() {
  try {
    const settings = await new Promise((resolve) => {
      chrome.runtime.sendMessage({ action: "getSettings" }, resolve);
    });

    // Set form values
    document.getElementById('sourceLanguage').value = settings.sourceLanguage || 'auto';
    document.getElementById('targetLanguage').value = settings.targetLanguage || 'bn';
    document.getElementById('clickCount').value = settings.clickCount || 3;
    document.getElementById('enableClickTranslation').checked = settings.enableClickTranslation !== false;
    document.getElementById('enableContextMenu').checked = settings.enableContextMenu !== false;
    document.getElementById('enableVisualFeedback').checked = settings.enableVisualFeedback !== false;

    updateLanguagePreview();
  } catch (error) {
    console.error('Error loading settings:', error);
    showStatus('Error loading settings. Please refresh.', 'error');
  }
}

async function saveSettings() {
  try {
    const settings = {
      sourceLanguage: document.getElementById('sourceLanguage').value,
      targetLanguage: document.getElementById('targetLanguage').value,
      clickCount: parseInt(document.getElementById('clickCount').value),
      enableClickTranslation: document.getElementById('enableClickTranslation').checked,
      enableContextMenu: document.getElementById('enableContextMenu').checked,
      enableVisualFeedback: document.getElementById('enableVisualFeedback').checked
    };

    await chrome.storage.local.set(settings);

    // Update context menu if needed
    if (!settings.enableContextMenu) {
      chrome.runtime.sendMessage({ action: "removeContextMenu" });
    } else {
      // If enabling context menu or changing language, update it
      chrome.runtime.sendMessage({ action: "updateContextMenu" });
    }

    // Show success message with language info
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
      'hi': 'Hindi',
      'auto': 'Auto-detect'
    };

    const sourceLang = langNames[settings.sourceLanguage] || settings.sourceLanguage;
    const targetLang = langNames[settings.targetLanguage] || settings.targetLanguage;

    let message = `Settings saved! Translating from ${sourceLang} to ${targetLang}.`;

    if (settings.enableContextMenu) {
      message += ' Context menu enabled.';
    }

    if (settings.enableClickTranslation) {
      message += ` Click ${settings.clickCount}x to translate.`;
    }

    showStatus(message, 'success');

    // Send update to all tabs
    chrome.tabs.query({}, (tabs) => {
      tabs.forEach(tab => {
        if (tab.id) {
          chrome.tabs.sendMessage(tab.id, {
            action: 'settingsUpdated',
            settings: settings
          }).catch(() => {
            // Tab might not have content script loaded
          });
        }
      });
    });

    // Auto-hide success message after 5 seconds
    setTimeout(() => {
      const statusDiv = document.getElementById('status');
      if (statusDiv.classList.contains('success')) {
        statusDiv.style.display = 'none';
      }
    }, 5000);

  } catch (error) {
    console.error('Error saving settings:', error);
    showStatus('Error saving settings. Please try again.', 'error');
  }
}

function updateLanguagePreview() {
  const targetLang = document.getElementById('targetLanguage').value;
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

  // Update any language display elements if needed
  const contextMenuCheckbox = document.getElementById('enableContextMenu');
  if (contextMenuCheckbox.checked) {
    const langName = langNames[targetLang] || targetLang;
    contextMenuCheckbox.nextElementSibling.innerHTML =
      `Enable right-click context menu <span class="language-display">Translate to ${langName}</span>`;
  }
}

function showStatus(message, type) {
  const statusDiv = document.getElementById('status');
  statusDiv.textContent = message;
  statusDiv.className = `status ${type}`;
  statusDiv.style.display = 'block';
}