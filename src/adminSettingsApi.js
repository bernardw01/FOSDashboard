/**
 * PRD version 2.2.0 — Admin settings panel API (feature 011).
 */

/**
 * @param {{ role?: string }} auth
 * @return {boolean}
 */
function isAdminUser_(auth) {
  return !!(auth && String(auth.role || '').trim().toUpperCase() === 'ADMIN');
}

/**
 * @param {{ role?: string }} auth
 * @return {{ role: string, team: string, email: string }}
 */
function requireAdminRole_(auth) {
  if (!auth || !auth.email) {
    throw new Error('NOT_AUTHORIZED');
  }
  if (!isAdminUser_(auth)) {
    throw new Error('FORBIDDEN');
  }
  return auth;
}

/**
 * @return {boolean}
 * @private
 */
function isAdminSettingsPropertySet_(raw) {
  if (raw === null || raw === undefined) {
    return false;
  }
  return String(raw).trim() !== '';
}

/**
 * @param {!Object} entry
 * @param {?string} raw
 * @return {*}
 * @private
 */
function parseAdminSettingValueForDisplay_(entry, raw) {
  var type = entry.type;
  if (type === 'secret') {
    return '';
  }
  if (!isAdminSettingsPropertySet_(raw)) {
    if (entry.defaultValue === null || entry.defaultValue === undefined) {
      return '';
    }
    return entry.defaultValue;
  }
  if (type === 'boolean') {
    return parseBoolean_(raw, entry.defaultValue === true);
  }
  if (type === 'number') {
    var n = parseFloat(String(raw).trim());
    return isFinite(n) ? n : entry.defaultValue;
  }
  if (type === 'json') {
    return String(raw).trim();
  }
  return String(raw).trim();
}

/**
 * @param {!Object} entry
 * @param {*} value
 * @return {string}
 * @private
 */
function serializeAdminSettingValue_(entry, value) {
  if (entry.type === 'boolean') {
    return value ? 'true' : 'false';
  }
  if (entry.type === 'number') {
    return String(value);
  }
  if (entry.type === 'json') {
    return String(value || '').trim();
  }
  return String(value == null ? '' : value).trim();
}

/**
 * @param {!Object} entry
 * @param {*} value
 * @param {boolean} useDefault
 * @return {?string}
 * @private
 */
function validateAdminSettingValue_(entry, value, useDefault) {
  if (entry.readOnly) {
    return 'This setting is read-only.';
  }
  if (useDefault) {
    if (!entry.allowDefaultToggle) {
      return 'This setting cannot use the built-in default.';
    }
    return null;
  }

  if (entry.type === 'secret') {
    var secret = String(value || '').trim();
    if (!secret) {
      return null;
    }
    if (secret.length < 8) {
      return 'Token must be at least 8 characters.';
    }
    return null;
  }

  if (entry.required && (value === null || value === undefined || String(value).trim() === '')) {
    return 'This setting is required.';
  }

  if (entry.type === 'number') {
    var n = parseFloat(String(value));
    if (!isFinite(n)) {
      return 'Enter a valid number.';
    }
    if (entry.min != null && n < entry.min) {
      return 'Minimum value is ' + entry.min + '.';
    }
    if (entry.max != null && n > entry.max) {
      return 'Maximum value is ' + entry.max + '.';
    }
    return null;
  }

  if (entry.type === 'boolean') {
    return null;
  }

  if (entry.type === 'json') {
    var rawJson = String(value || '').trim();
    if (!rawJson) {
      return entry.required ? 'JSON cannot be empty.' : null;
    }
    try {
      var parsed = JSON.parse(rawJson);
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
        return 'JSON must be an object (e.g. {"Company": 40}).';
      }
      var keys = Object.keys(parsed);
      for (var ki = 0; ki < keys.length; ki++) {
        var hv = parsed[keys[ki]];
        if (typeof hv !== 'number' || !isFinite(hv) || hv <= 0) {
          return 'Each value must be a positive number.';
        }
      }
    } catch (e) {
      return 'Invalid JSON.';
    }
    return null;
  }

  if (entry.type === 'string' || entry.type === 'csv') {
    var s = String(value == null ? '' : value).trim();
    if (entry.required && !s) {
      return 'This setting is required.';
    }
    if (entry.key === 'FIBERY_PUBLIC_SCHEME') {
      var scheme = s.toLowerCase();
      if (scheme !== 'http' && scheme !== 'https') {
        return 'Scheme must be http or https.';
      }
    }
    if (entry.key === 'FIBERY_HOST' && s) {
      if (s.indexOf('://') >= 0) {
        return 'Host must not include a scheme (no https://).';
      }
    }
    return null;
  }

  return null;
}

/**
 * Resolves warn/crit stale days after applying updates.
 * @param {!Object<string, string>} propsMap
 * @param {!Array<!Object>} updates
 * @return {?string}
 * @private
 */
function validateUtilizationStaleDaysCrossField_(propsMap, updates) {
  var byKey = getAdminSettingsByKey_();
  var warnEntry = byKey['UTILIZATION_STALE_APPROVAL_WARN_DAYS'];
  var critEntry = byKey['UTILIZATION_STALE_APPROVAL_CRIT_DAYS'];
  if (!warnEntry || !critEntry) {
    return null;
  }

  function resolvedNum(key, entry) {
    for (var u = 0; u < updates.length; u++) {
      if (updates[u].key === key) {
        if (updates[u].useDefault) {
          return Number(entry.defaultValue);
        }
        return parseFloat(String(updates[u].value));
      }
    }
    var raw = propsMap[key];
    if (!isAdminSettingsPropertySet_(raw)) {
      return Number(entry.defaultValue);
    }
    return parseFloat(String(raw));
  }

  var warn = resolvedNum('UTILIZATION_STALE_APPROVAL_WARN_DAYS', warnEntry);
  var crit = resolvedNum('UTILIZATION_STALE_APPROVAL_CRIT_DAYS', critEntry);
  if (!isFinite(warn) || !isFinite(crit) || crit <= warn) {
    return 'Stale approval critical days must be greater than warn days.';
  }
  return null;
}

/**
 * @return {{ ok: boolean, isAdmin: boolean, groups: !Array<!Object>, message?: string }}
 */
function getAdminSettingsPanel() {
  var auth = requireAuthForApi_();
  if (!isAdminUser_(auth)) {
    return { ok: false, isAdmin: false, groups: [], message: 'Administrator access required.' };
  }

  return {
    ok: true,
    isAdmin: true,
    groups: buildAdminSettingsGroupsView_(PropertiesService.getScriptProperties()),
  };
}

/**
 * @param {GoogleAppsScript.Properties.Properties} props
 * @return {!Array<!Object>}
 * @private
 */
function buildAdminSettingsGroupsView_(props) {
  var catalog = getAdminSettingsCatalog_();
  var byKey = getAdminSettingsByKey_();
  var propsMap = props.getProperties();
  var groupMap = {};
  for (var g = 0; g < ADMIN_SETTINGS_GROUPS_.length; g++) {
    groupMap[ADMIN_SETTINGS_GROUPS_[g].id] = {
      id: ADMIN_SETTINGS_GROUPS_[g].id,
      title: ADMIN_SETTINGS_GROUPS_[g].title,
      settings: [],
    };
  }

  for (var i = 0; i < catalog.length; i++) {
    var entry = catalog[i];
    var raw = propsMap[entry.key];
    var hasOverride = isAdminSettingsPropertySet_(raw);
    var useDefault = entry.allowDefaultToggle ? !hasOverride : false;
    var displayValue = parseAdminSettingValueForDisplay_(entry, raw);

    var row = {
      key: entry.key,
      label: entry.label,
      description: entry.description,
      type: entry.type,
      defaultValue: entry.defaultValue,
      useDefault: useDefault,
      value: displayValue,
      min: entry.min,
      max: entry.max,
      required: entry.required,
      readOnly: entry.readOnly,
      sensitive: entry.sensitive,
      allowDefaultToggle: entry.allowDefaultToggle,
      hasStoredSecret: entry.type === 'secret' && hasOverride,
    };

    if (entry.type === 'secret') {
      row.value = '';
      row.masked = hasOverride ? '••••••••' : '';
    }

    if (entry.readOnly && entry.key === 'AUTH_SPREADSHEET_ID') {
      row.value = hasOverride ? String(raw).trim() : '';
    }
    if (entry.readOnly && entry.key === 'FOS_SNAPSHOT_DRIVE_FOLDER_ID') {
      row.value = hasOverride ? String(raw).trim() : '';
    }

    var grp = groupMap[entry.group];
    if (grp) {
      grp.settings.push(row);
    }
  }

  var out = [];
  for (var gi = 0; gi < ADMIN_SETTINGS_GROUPS_.length; gi++) {
    var id = ADMIN_SETTINGS_GROUPS_[gi].id;
    if (groupMap[id]) {
      out.push(groupMap[id]);
    }
  }
  return out;
}

/**
 * @param {{ updates: !Array<{ key: string, useDefault: boolean, value?: * }> }} payload
 * @return {{ ok: boolean, saved?: !Array<string>, errors?: !Array<{ key: string, message: string }>, message?: string }}
 */
function saveAdminSettings(payload) {
  var auth = requireAuthForApi_();
  requireAdminRole_(auth);

  var updates = payload && payload.updates ? payload.updates : [];
  if (!updates.length) {
    return { ok: false, message: 'No changes to save.' };
  }

  var byKey = getAdminSettingsByKey_();
  var props = PropertiesService.getScriptProperties();
  var propsMap = props.getProperties();
  var errors = [];
  var toApply = [];

  for (var i = 0; i < updates.length; i++) {
    var u = updates[i];
    var key = String(u.key || '').trim();
    var entry = byKey[key];
    if (!entry) {
      errors.push({ key: key || '(unknown)', message: 'Unknown setting.' });
      continue;
    }
    if (entry.readOnly) {
      errors.push({ key: key, message: 'Read-only setting.' });
      continue;
    }
    var useDefault = !!u.useDefault;
    var err = validateAdminSettingValue_(entry, u.value, useDefault);
    if (err) {
      errors.push({ key: key, message: err });
      continue;
    }
    toApply.push({ key: key, entry: entry, useDefault: useDefault, value: u.value });
  }

  if (errors.length) {
    return { ok: false, errors: errors };
  }

  var crossErr = validateUtilizationStaleDaysCrossField_(propsMap, toApply);
  if (crossErr) {
    return {
      ok: false,
      errors: [
        { key: 'UTILIZATION_STALE_APPROVAL_CRIT_DAYS', message: crossErr },
        { key: 'UTILIZATION_STALE_APPROVAL_WARN_DAYS', message: crossErr },
      ],
    };
  }

  var savedKeys = [];
  for (var j = 0; j < toApply.length; j++) {
    var item = toApply[j];
    if (item.useDefault) {
      props.deleteProperty(item.key);
      savedKeys.push(item.key);
      continue;
    }
    if (item.entry.type === 'secret') {
      var token = String(item.value || '').trim();
      if (!token) {
        continue;
      }
      props.setProperty(item.key, token);
      savedKeys.push(item.key);
      continue;
    }
    props.setProperty(item.key, serializeAdminSettingValue_(item.entry, item.value));
    savedKeys.push(item.key);
  }

  try {
    logAdminSettingsSave_(auth, savedKeys);
  } catch (e) {
    /* ignore */
  }

  return { ok: true, saved: savedKeys };
}

/**
 * @param {{ email: string, role: string }} auth
 * @param {!Array<string>} keys
 * @private
 */
function logAdminSettingsSave_(auth, keys) {
  if (!isActivityLoggingEnabled_()) {
    return;
  }
  writeActivityRow_({
    email: auth.email,
    role: auth.role,
    team: auth.team || '',
    eventType: 'admin_settings_save',
    route: 'settings',
    label: keys.length ? 'keys=' + keys.join(',') : '',
    sessionId: '',
    userAgent: '',
  });
}
