/**
 * PRD version 2.17.1 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Match AI usage rows to Agreement Management/Clockify Users + Actor Mapping.
 */

/**
 * @return {!{
 *   clockifyByEmail: !Object<string, !{ fiberyId: string, email: string, clockifyId: string|null, name: string|null }>,
 *   actorMappings: !Object<string, !{ fiberyId: string, email: string|null, clockifyId: string|null, allocation: string|null }>,
 *   warnings: !Array<string>
 * }}
 */
function aiUsageLoadMatchContext_() {
  var warnings = [];
  var clockifyByEmail = aiUsageLoadClockifyUsersByEmail_();
  var actorMappings = aiUsageLoadActorMappings_(warnings);
  return { clockifyByEmail: clockifyByEmail, actorMappings: actorMappings, warnings: warnings };
}

/**
 * @param {!Array<!Object>} rows
 * @param {!Object} matchContext
 * @return {!{ rows: !Array<!Object>, matched: number, unmatched: number }}
 */
function aiUsageApplyUserMatching_(rows, matchContext) {
  var matched = 0;
  var unmatched = 0;
  var clockifyByEmail = matchContext.clockifyByEmail || {};
  var actorMappings = matchContext.actorMappings || {};

  rows.forEach(function (row) {
    var hit = null;
    if (row.actorEmail) {
      hit = clockifyByEmail[String(row.actorEmail).toLowerCase()] || null;
    }
    if (!hit && row.actorExternalId && row.sourcePlatform) {
      var mapKey = aiUsageActorMappingKey_(row.sourcePlatform, row.actorExternalId);
      var mapping = actorMappings[mapKey] || null;
      if (mapping) {
        hit = mapping;
        if (mapping.allocation) {
          row.allocationCategory = mapping.allocation;
        }
      }
    }
    if (!hit && row.actorType === 'Service account') {
      row.mappingStatus = 'Service account';
      unmatched++;
      return;
    }
    if (hit) {
      row.clockifyUserFiberyId = hit.fiberyId;
      row.clockifyUserEmail = hit.email || row.actorEmail || null;
      row.clockifyUserId = hit.clockifyId || null;
      row.mappingStatus = row.actorType === 'API key' ? 'Matched' : 'Matched';
      matched++;
    } else {
      row.mappingStatus = 'Unmatched';
      unmatched++;
    }
  });

  return { rows: rows, matched: matched, unmatched: unmatched };
}

/**
 * @param {string} platform
 * @param {string} externalId
 * @return {string}
 */
function aiUsageActorMappingKey_(platform, externalId) {
  return String(platform).toLowerCase() + '::' + String(externalId);
}

/**
 * @return {!Object<string, !{ fiberyId: string, email: string, clockifyId: string|null, name: string|null }>}
 */
function aiUsageLoadClockifyUsersByEmail_() {
  var index = {};
  var offset = 0;
  var pageSize = 500;
  var guard = 0;
  while (guard < 20) {
    var batch = fiberyBatchQuery_([
      {
        query: {
          'q/from': 'Agreement Management/Clockify Users',
          'q/select': {
            Id: ['fibery/id'],
            Email: ['Agreement Management/Clockify User Email'],
            ClockifyId: ['Agreement Management/Clockify User ID'],
            Name: ['Agreement Management/Name'],
          },
          'q/limit': pageSize,
          'q/offset': offset,
        },
      },
    ]);
    if (!batch.ok) {
      console.warn('aiUsageLoadClockifyUsersByEmail_: ' + batch.message);
      break;
    }
    var rows = batch.results[0] || [];
    if (!rows.length) {
      break;
    }
    rows.forEach(function (row) {
      var email = row.Email ? String(row.Email).trim().toLowerCase() : '';
      if (!email || !row.Id) {
        return;
      }
      index[email] = {
        fiberyId: String(row.Id),
        email: String(row.Email).trim(),
        clockifyId: row.ClockifyId ? String(row.ClockifyId) : null,
        name: row.Name ? String(row.Name) : null,
      };
    });
    if (rows.length < pageSize) {
      break;
    }
    offset += pageSize;
    guard++;
  }
  return index;
}

/**
 * @param {!Array<string>} warnings
 * @return {!Object<string, !{ fiberyId: string, email: string|null, clockifyId: string|null, allocation: string|null }>}
 */
function aiUsageLoadActorMappings_(warnings) {
  var index = {};
  var platformField = aiUsageField_('Source Platform');
  var externalIdField = aiUsageField_('External Actor Id');
  var emailField = aiUsageField_('Clockify User Email');
  var userField = aiUsageField_('Clockify User');
  var allocationField = aiUsageField_('Default Allocation Category');

  var batch = fiberyBatchQuery_([
    {
      query: {
        'q/from': aiUsageActorMappingDatabase_(),
        'q/select': {
          Platform: [platformField, 'enum/name'],
          ExternalId: [externalIdField],
          UserId: [userField, 'fibery/id'],
          UserEmail: [emailField],
          UserClockifyId: [userField, 'Agreement Management/Clockify User ID'],
          Allocation: [allocationField, 'enum/name'],
        },
        'q/limit': 1000,
      },
    },
  ]);
  if (!batch.ok) {
    warnings.push('Actor Mapping not loaded: ' + batch.message);
    return index;
  }
  var rawCount = (batch.results[0] || []).length;
  (batch.results[0] || []).forEach(function (row) {
    var platform = row.Platform ? String(row.Platform) : '';
    var externalId = row.ExternalId ? String(row.ExternalId) : '';
    if (!platform || !externalId || !row.UserId) {
      return;
    }
    index[aiUsageActorMappingKey_(platform, externalId)] = {
      fiberyId: String(row.UserId),
      email: row.UserEmail ? String(row.UserEmail) : null,
      clockifyId: row.UserClockifyId ? String(row.UserClockifyId) : null,
      allocation: row.Allocation ? String(row.Allocation) : null,
    };
  });
  if (rawCount > 0 && Object.keys(index).length === 0) {
    warnings.push(
      'Actor Mapping has ' +
        rawCount +
        ' row(s) but none with Source Platform + External Actor Id + Clockify User'
    );
  }
  return index;
}
