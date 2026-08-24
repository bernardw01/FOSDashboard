/**
 * PRD version 3.9.2 - sync with docs/FOS-Dashboard-PRD.md
 *
 * Feature 036 cutover: panel hydrate builders that read Supabase typed
 * tables (Agreement Management mirror from `supabaseAmMirror.js`, labor
 * facts from `fos_labor_costs`) instead of aggregating live Fibery queries.
 *
 * IMPORTANT (product rule): Labor facts come ONLY from Clockify via
 * `fos_labor_costs`. Fibery `Agreement Management/Labor Costs` is never
 * read here. `fos_am_labor_costs` is deprecated and unused.
 *
 * Output payload shapes / `cacheSchemaVersion` constants match the existing
 * Fibery builders exactly (`fiberyAgreementDashboard.js`,
 * `fiberyUtilizationDashboard.js`, `pipelineDashboard.js`,
 * `resourceAssignmentDashboard.js`, `aiUsageDashboard.js`,
 * `deliveryDashboard.js`, `portfolioPnlDashboard.js`) - only `source`
 * differs (`'supabase'`). This keeps `DashboardShell.html` client caches and
 * `dashboardSnapshotJob.js` unaffected.
 *
 * Public builders (called from `supabaseSyncJob.js`):
 *   buildAgreementDashboardPayloadFromSupabase_()
 *   buildUtilizationDashboardPayloadFromSupabase_(startIso, endIso)
 *   buildPipelineDashboardPayloadFromSupabase_()
 *   mirrorHubspotDealsToSupabase_()
 *   buildResourceAssignmentDashboardPayloadFromSupabase_(rangeStartYmd, rangeEndYmd)
 *   mirrorAiUsageRowsFromFibery_()
 *   buildAiUsagePayloadFromSupabase_(rangeStart, rangeEnd)
 *   buildDeliveryProjectMonthlyPnLFromSupabase_(agreementId, options)
 *   buildPortfolioMonthlyPnLFromSupabaseInternal_(agreementId)
 *   buildPortfolioPnlBundleFromSupabase_()
 *
 * Dimension tables (companies, agreements, Clockify users, roles) are small
 * and read once per script execution via a module-scoped cache
 * (`supabaseDimCacheGet_`) so builders that loop over many
 * agreements/projects in one run (Portfolio P&L) don't re-fetch per row.
 */

// ---------------------------------------------------------------------------
// Dimension caches (module-scoped; one script execution only)
// ---------------------------------------------------------------------------

/** @private */
var SUPABASE_PANEL_BUILDERS_DIM_CACHE_ = {};

/**
 * @param {string} key
 * @param {function(): *} loaderFn
 * @return {*}
 * @private
 */
function supabaseDimCacheGet_(key, loaderFn) {
  if (!Object.prototype.hasOwnProperty.call(SUPABASE_PANEL_BUILDERS_DIM_CACHE_, key)) {
    SUPABASE_PANEL_BUILDERS_DIM_CACHE_[key] = loaderFn();
  }
  return SUPABASE_PANEL_BUILDERS_DIM_CACHE_[key];
}

/**
 * `fos_agreements` keyed by `fibery_id`. Small columns only (name, customer,
 * Clockify project id) - enough for cross-panel joins.
 * @return {!Object<string, !Object>}
 */
function loadFosAgreementsMetaMap_() {
  return supabaseDimCacheGet_('agreementsByFiberyId', function () {
    var map = {};
    var res = supabaseSelectAll_(
      'fos_agreements',
      null,
      'fibery_id,name,customer_id,clockify_project_id'
    );
    if (!res.ok) {
      supabaseWarn_('loadFosAgreementsMetaMap_ failed', { message: res.message });
      return map;
    }
    var rows = res.rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].fibery_id) {
        map[rows[i].fibery_id] = rows[i];
      }
    }
    return map;
  });
}

/**
 * `fos_agreements` keyed by `clockify_project_id` (for joining `fos_labor_costs`
 * rows, which key on the Clockify project id, back to their agreement).
 * @return {!Object<string, !Object>}
 */
function loadFosAgreementsByClockifyProjectIdMap_() {
  return supabaseDimCacheGet_('agreementsByClockifyProjectId', function () {
    var byId = loadFosAgreementsMetaMap_();
    var map = {};
    for (var k in byId) {
      if (!Object.prototype.hasOwnProperty.call(byId, k)) continue;
      var a = byId[k];
      if (a.clockify_project_id) {
        map[String(a.clockify_project_id)] = a;
      }
    }
    return map;
  });
}

/**
 * `fos_companies` keyed by `fibery_id`.
 * @return {!Object<string, !Object>}
 */
function loadFosCompaniesMap_() {
  return supabaseDimCacheGet_('companiesByFiberyId', function () {
    var map = {};
    var res = supabaseSelectAll_('fos_companies', null, 'fibery_id,name');
    if (!res.ok) {
      supabaseWarn_('loadFosCompaniesMap_ failed', { message: res.message });
      return map;
    }
    var rows = res.rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].fibery_id) {
        map[rows[i].fibery_id] = rows[i];
      }
    }
    return map;
  });
}

/**
 * `fos_clockify_users` keyed by `fibery_id` (the AM-mirror relation id, used
 * by `fos_resource_allocations.clockify_user_id`).
 * @return {!Object<string, !Object>}
 */
function loadFosClockifyUsersMap_() {
  return supabaseDimCacheGet_('clockifyUsersByFiberyId', function () {
    var map = {};
    var res = supabaseSelectAll_(
      'fos_clockify_users',
      null,
      'fibery_id,name,clockify_user_id,clockify_user_email,company_enum_name,work_status_name,team_member_role_id,team_member_role_cost_rate'
    );
    if (!res.ok) {
      supabaseWarn_('loadFosClockifyUsersMap_ failed', { message: res.message });
      return map;
    }
    var rows = res.rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].fibery_id) {
        map[rows[i].fibery_id] = rows[i];
      }
    }
    return map;
  });
}

/**
 * `fos_clockify_users` keyed by `clockify_user_id` and by email (lowercased).
 * `fos_labor_costs.user_id` may be either a Clockify id or an email depending
 * on the Clockify sync payload.
 * @return {!Object<string, !Object>}
 */
function loadFosClockifyUsersByClockifyIdMap_() {
  return supabaseDimCacheGet_('clockifyUsersByClockifyId', function () {
    var byFiberyId = loadFosClockifyUsersMap_();
    var map = {};
    for (var k in byFiberyId) {
      if (!Object.prototype.hasOwnProperty.call(byFiberyId, k)) continue;
      var u = byFiberyId[k];
      if (u.clockify_user_id) {
        map[String(u.clockify_user_id)] = u;
      }
      if (u.clockify_user_email) {
        map[String(u.clockify_user_email).toLowerCase()] = u;
      }
    }
    return map;
  });
}

/**
 * `fos_team_member_roles` keyed by `fibery_id`.
 * @return {!Object<string, !Object>}
 */
function loadFosTeamMemberRolesMap_() {
  return supabaseDimCacheGet_('teamMemberRolesByFiberyId', function () {
    var map = {};
    var res = supabaseSelectAll_('fos_team_member_roles', null, 'fibery_id,name,cost_rate,bill_rate');
    if (!res.ok) {
      supabaseWarn_('loadFosTeamMemberRolesMap_ failed', { message: res.message });
      return map;
    }
    var rows = res.rows || [];
    for (var i = 0; i < rows.length; i++) {
      if (rows[i] && rows[i].fibery_id) {
        map[rows[i].fibery_id] = rows[i];
      }
    }
    return map;
  });
}

// ---------------------------------------------------------------------------
// 1. Agreement Dashboard
// ---------------------------------------------------------------------------

/**
 * Builds the Agreement Dashboard payload from Supabase typed tables
 * (`fos_agreements`, `fos_companies`, `fos_company_segments`,
 * `fos_revenue_items`) instead of live Fibery queries. Reuses every
 * normalization / KPI / chart function from `fiberyAgreementDashboard.js`
 * unchanged - only the raw row assembly differs.
 *
 * @return {!Object} Same shape as `buildAgreementDashboardPayload_`, `source: 'supabase'`.
 */
function buildAgreementDashboardPayloadFromSupabase_() {
  var now = new Date();
  var fetchedAtIso = now.toISOString();
  var todayIso = formatDateOnlyIso_(now);
  var ttlMinutes = resolveAgreementCacheTtlMinutes_();
  var thresholds = getAgreementThresholds_();

  var agreementsRes = supabaseSelectAll_(
    'fos_agreements',
    { or: '(state_name.is.null,state_name.neq.Closed-Lost)' },
    'fibery_id,public_id,name,state_name,agreement_type,agreement_progress_name,' +
      'customer_id,assigned_owner_id,total_planned_revenue,rev_recognized,total_labor_costs,total_materials_odc,' +
      'current_margin,target_margin,duration_start,duration_end,execution_date'
  );
  if (!agreementsRes.ok) {
    return emptyAgreementPayloadFromSupabase_(
      fetchedAtIso, ttlMinutes,
      agreementsRes.message || 'Could not read fos_agreements.', agreementsRes.reason
    );
  }

  var ownerUsersMap = loadFosClockifyUsersMap_();

  var companiesRes = supabaseSelectAll_(
    'fos_companies',
    null,
    'fibery_id,public_id,name,funnel_stage_name,lead_source_name,total_customer_contract_value,nda_completed'
  );
  if (!companiesRes.ok) {
    return emptyAgreementPayloadFromSupabase_(
      fetchedAtIso, ttlMinutes,
      companiesRes.message || 'Could not read fos_companies.', companiesRes.reason
    );
  }

  var segmentsRes = supabaseSelectAll_('fos_company_segments', null, 'company_fibery_id,segment_name');
  var segmentsByCompany = {};
  if (segmentsRes.ok) {
    var segRows = segmentsRes.rows || [];
    for (var si = 0; si < segRows.length; si++) {
      var sr = segRows[si];
      if (!sr.company_fibery_id || !sr.segment_name) continue;
      if (!segmentsByCompany[sr.company_fibery_id]) {
        segmentsByCompany[sr.company_fibery_id] = [];
      }
      segmentsByCompany[sr.company_fibery_id].push(sr.segment_name);
    }
  } else {
    supabaseWarn_('agreement Supabase build: segments fetch failed', { message: segmentsRes.message });
  }

  var revenueRes = supabaseSelectAll_(
    'fos_revenue_items',
    null,
    'fibery_id,name,agreement_id,target_amount,actual_amount,target_date,revenue_recognized,state_name'
  );
  if (!revenueRes.ok) {
    return emptyAgreementPayloadFromSupabase_(
      fetchedAtIso, ttlMinutes,
      revenueRes.message || 'Could not read fos_revenue_items.', revenueRes.reason
    );
  }

  var agreementRows = agreementsRes.rows || [];
  var companyRows = companiesRes.rows || [];
  var companyNameById = {};
  for (var ci = 0; ci < companyRows.length; ci++) {
    companyNameById[companyRows[ci].fibery_id] = companyRows[ci].name || '';
  }
  var agreementNameById = {};
  var agreementCustomerIdById = {};
  for (var ai = 0; ai < agreementRows.length; ai++) {
    var arow = agreementRows[ai];
    agreementNameById[arow.fibery_id] = arow.name || '';
    agreementCustomerIdById[arow.fibery_id] = arow.customer_id || null;
  }

  var rawAgreements = [];
  for (var a2 = 0; a2 < agreementRows.length; a2++) {
    var r = agreementRows[a2];
    var custId = r.customer_id;
    var ownerId = r.assigned_owner_id || null;
    var ownerRow = ownerId && ownerUsersMap[ownerId] ? ownerUsersMap[ownerId] : null;
    var ownerName = ownerRow && ownerRow.name ? String(ownerRow.name).trim() : '';
    rawAgreements.push({
      id: r.fibery_id,
      publicId: r.public_id,
      name: r.name,
      state: r.state_name,
      // `agreement_type` column stores the enum NAME (see amMirrorMapAgreement_).
      type: r.agreement_type,
      progress: r.agreement_progress_name,
      customer: custId ? (companyNameById[custId] || null) : null,
      assignedOwner: ownerName || null,
      plannedRev: r.total_planned_revenue,
      revRec: r.rev_recognized,
      laborCosts: r.total_labor_costs,
      materialsOdc: r.total_materials_odc,
      margin: r.current_margin,
      targetMargin: r.target_margin,
      duration: { start: r.duration_start, end: r.duration_end },
      executionDate: r.execution_date,
    });
  }

  var rawCompanies = [];
  for (var c2 = 0; c2 < companyRows.length; c2++) {
    var cr = companyRows[c2];
    rawCompanies.push({
      id: cr.fibery_id,
      publicId: cr.public_id,
      name: cr.name,
      funnelStage: cr.funnel_stage_name,
      segment: segmentsByCompany[cr.fibery_id] || [],
      leadSource: cr.lead_source_name,
      totalContractValue: cr.total_customer_contract_value,
      ndaCompleted: cr.nda_completed,
    });
  }

  var historicalRaw = [];
  var futureRaw = [];
  var revenueRows = revenueRes.rows || [];
  for (var ri = 0; ri < revenueRows.length; ri++) {
    var rr = revenueRows[ri];
    var agAgreementId = rr.agreement_id;
    var agName = agAgreementId ? (agreementNameById[agAgreementId] || null) : null;
    var custIdForAgreement = agAgreementId ? agreementCustomerIdById[agAgreementId] : null;
    var custName = custIdForAgreement ? (companyNameById[custIdForAgreement] || null) : null;
    var mapped = {
      id: rr.fibery_id,
      name: rr.name,
      targetAmount: rr.target_amount,
      actualAmount: rr.actual_amount,
      targetDate: rr.target_date,
      recognized: rr.revenue_recognized,
      state: rr.state_name,
      agreement: agName,
      agreementId: agAgreementId,
      customer: custName,
    };
    if (rr.revenue_recognized === true) {
      historicalRaw.push(mapped);
    } else if (rr.target_date && rr.target_date > todayIso) {
      futureRaw.push(mapped);
    }
  }

  var companies = normalizeCompanies_(rawCompanies);
  var futureRevenueItems = normalizeRevenueItems_(futureRaw);
  var historicalRevenueItems = normalizeRevenueItems_(historicalRaw);
  var agreements = normalizeAgreements_(rawAgreements);

  enrichAgreementsWithRevenueItems_(agreements, futureRevenueItems, historicalRevenueItems);
  var revenueItemsByAgreement = groupRevenueItemsByAgreement_(historicalRevenueItems, futureRevenueItems);

  var companyByName = indexByLowercaseName_(companies);
  var customerOrder = buildCustomerOrder_(companies, thresholds);
  var customerColorMap = buildCustomerColorMap_(customerOrder, thresholds.customerPalette);

  var kpis = computeKpis_(agreements, companies, companyByName, thresholds);
  var alerts = evaluateAlerts_(agreements, futureRevenueItems, thresholds);
  var charts = buildChartViewModels_(agreements, companies, companyByName, customerColorMap, thresholds);
  var financialTable = buildFinancialTable_(agreements, kpis.topCustomerName, thresholds);
  var customerCards = buildCustomerCards_(companies, customerColorMap, thresholds);
  var forwardPipeline = buildForwardPipeline_(agreements, futureRevenueItems, customerColorMap, thresholds);
  var sankey = buildSankey_(agreements, customerColorMap, thresholds);

  return {
    ok: true,
    source: 'supabase',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttlMinutes,
    agreements: agreements,
    companies: companies,
    futureRevenueItems: futureRevenueItems,
    historicalRevenueItems: historicalRevenueItems,
    revenueItemsByAgreement: revenueItemsByAgreement,
    kpis: kpis,
    alerts: alerts,
    charts: charts,
    financialTable: financialTable,
    customerCards: customerCards,
    forwardPipeline: forwardPipeline,
    sankey: sankey,
  };
}

/**
 * @param {string} fetchedAtIso
 * @param {number} ttlMinutes
 * @param {string} message
 * @param {string=} reason
 * @return {!Object}
 * @private
 */
function emptyAgreementPayloadFromSupabase_(fetchedAtIso, ttlMinutes, message, reason) {
  return {
    ok: false,
    source: 'supabase',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: AGREEMENT_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: ttlMinutes,
    agreements: [],
    companies: [],
    futureRevenueItems: [],
    historicalRevenueItems: [],
    kpis: emptyKpis_(),
    alerts: [],
    charts: emptyCharts_(),
    financialTable: emptyFinancialTable_(),
    customerCards: [],
    forwardPipeline: emptyForwardPipeline_(),
    sankey: emptySankey_(),
    message: message || 'Could not load agreement data from Supabase.',
    warnings: ['Supabase error: ' + (reason || 'UNKNOWN')],
  };
}

// ---------------------------------------------------------------------------
// 2. Utilization Dashboard
// ---------------------------------------------------------------------------

/**
 * Builds the Utilization Dashboard payload from `fos_labor_costs` (already
 * Supabase / Clockify-sourced). Thin wrapper around
 * `buildUtilizationPayloadFromFosLaborCosts_` using the same default-range
 * resolution as `buildUtilizationDashboardPayload_(null, null)`.
 *
 * @param {?string=} rangeStart ISO datetime (inclusive).
 * @param {?string=} rangeEnd ISO datetime (exclusive upper bound).
 * @return {!Object}
 */
function buildUtilizationDashboardPayloadFromSupabase_(rangeStart, rangeEnd) {
  var now = new Date();
  var thresholds = getUtilizationThresholds_();
  var range = resolveRange_(rangeStart, rangeEnd, now, thresholds);
  var built = buildUtilizationPayloadFromFosLaborCosts_(range, thresholds, now);
  if (built && built.ok) {
    if (!built.dataWindow && built.range) {
      built.dataWindow = { start: built.range.start, end: built.range.end };
    }
    return built;
  }
  return {
    ok: false,
    source: 'supabase',
    fetchedAt: now.toISOString(),
    cacheSchemaVersion: UTILIZATION_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: thresholds.cacheTtlMinutes,
    range: range,
    dataWindow: { start: range.start, end: range.end },
    rows: [],
    kpis: emptyUtilizationKpis_(),
    dimensions: emptyUtilizationDimensions_(),
    aggregates: emptyUtilizationAggregates_(),
    alerts: [],
    laborHours: getLaborHoursConfig_(),
    message: (built && built.message) || 'Could not load utilization data from Supabase.',
    warnings: ['Supabase error: ' + ((built && built.reason) || 'UNKNOWN')],
  };
}

// ---------------------------------------------------------------------------
// 3. Pipeline Dashboard
// ---------------------------------------------------------------------------

/**
 * Full replace-upsert of HubSpot/Deal essential fields from Fibery into
 * `fos_hubspot_deals`. Stores the full Fibery row shape (as consumed by
 * `normalizeFiberyPipelineDeals_`) in the `raw` jsonb column so
 * `buildPipelineDashboardPayloadFromSupabase_` can reuse the exact same
 * merge logic as the Fibery builder without re-deriving fields.
 *
 * @return {!{ ok: true, count: number, truncated: boolean }|!{ ok: false, message: string }}
 */
function mirrorHubspotDealsToSupabase_() {
  var cfg = getPipelineProps_();
  var fetched = fetchAllPipelineDeals_(cfg.maxRows);
  if (!fetched.ok) {
    return { ok: false, message: fetched.message || 'HubSpot deal Fibery fetch failed.' };
  }
  var rows = fetched.rows || [];
  var upserted = 0;
  var batchSize = 200;
  var nowIso = new Date().toISOString();
  for (var i = 0; i < rows.length; i += batchSize) {
    var batch = rows.slice(i, i + batchSize);
    var mapped = [];
    for (var j = 0; j < batch.length; j++) {
      var d = batch[j];
      if (!d || !d.id) continue;
      var hubspotLink =
        d.hubspotLink !== null && d.hubspotLink !== undefined ? String(d.hubspotLink).trim() : '';
      mapped.push({
        fibery_id: String(d.id),
        hubspot_deal_id: pipelineParseHubspotDealId_(hubspotLink) || null,
        name: d.name || null,
        stage: d.stage || null,
        amount: pipelineToNumber_(d.amount),
        weighted_amount: pipelineToNumber_(d.weightedAmount),
        synced_at: nowIso,
        raw: d,
      });
    }
    if (!mapped.length) continue;
    var up = supabaseUpsert_('fos_hubspot_deals', mapped, 'fibery_id');
    if (!up.ok) {
      return { ok: false, message: up.message || 'fos_hubspot_deals upsert failed.' };
    }
    upserted += mapped.length;
  }
  return { ok: true, count: upserted, truncated: !!fetched.truncated };
}

/**
 * Builds the Pipeline Dashboard payload from `fos_hubspot_deals` instead of a
 * live Fibery `HubSpot/Deal` query. The sales-pipeline sheet side is
 * unchanged. Reuses `assemblePipelineDashboardPayload_` (shared with
 * `buildPipelineDashboardPayload_`) for the merge/bucket logic.
 *
 * @return {!Object}
 */
function buildPipelineDashboardPayloadFromSupabase_() {
  var cfg = getPipelineProps_();
  var fetchedAt = new Date().toISOString();
  var warnings = [];

  var sheetResult = readSalesPipelineSheetRows_();
  if (!sheetResult.ok) {
    return {
      ok: false,
      message: sheetResult.message || 'Could not read sales pipeline spreadsheet.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }
  if (sheetResult.warnings && sheetResult.warnings.length) {
    warnings = warnings.concat(sheetResult.warnings);
  }

  var dealsRes = supabaseSelectAll_('fos_hubspot_deals', null, 'fibery_id,raw');
  if (!dealsRes.ok) {
    return {
      ok: false,
      message: dealsRes.message || 'Could not read fos_hubspot_deals.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }
  var dealRows = dealsRes.rows || [];
  if (!dealRows.length) {
    return {
      ok: false,
      message:
        'HubSpot deals have not been mirrored to Supabase yet. Ask an ADMIN to run Pull from Fibery in Settings.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: PIPELINE_CACHE_SCHEMA_VERSION_,
    };
  }

  var rawDealRows = [];
  for (var i = 0; i < dealRows.length; i++) {
    var raw = dealRows[i].raw;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        raw = null;
      }
    }
    if (raw) {
      rawDealRows.push(raw);
    }
  }

  return assemblePipelineDashboardPayload_(
    rawDealRows,
    sheetResult,
    cfg,
    fetchedAt,
    warnings,
    'merged-supabase',
    !!dealsRes.truncated
  );
}

// ---------------------------------------------------------------------------
// 4. Resource Assignment Dashboard
// ---------------------------------------------------------------------------

/**
 * Builds the Resource Assignment Dashboard payload from
 * `fos_resource_allocations` (+ `fos_agreements` / `fos_companies` /
 * `fos_clockify_users` / `fos_team_member_roles` joins) and actual hours
 * from `fos_labor_costs`. Mirrors `buildResourceAssignmentDashboardPayload_`
 * exactly, reusing every shared aggregation helper from
 * `resourceAssignmentDashboard.js`.
 *
 * @param {?string} rangeStartYmd
 * @param {?string} rangeEndYmd
 * @return {!Object}
 */
function buildResourceAssignmentDashboardPayloadFromSupabase_(rangeStartYmd, rangeEndYmd) {
  var fetchedAt = new Date().toISOString();
  var warnings = [];
  var range = resolveResourceAssignmentRangeYmd_(rangeStartYmd, rangeEndYmd, warnings);
  var weeks = buildResourceAssignmentWeeks_(range.startYmd, range.endYmd, warnings);
  var weeklyCapacity = resolveResourceAssignmentWeeklyCapacity_();

  var allocationsRes = supabaseSelectAll_(
    'fos_resource_allocations',
    null,
    'fibery_id,allocation_name,agreement_id,clockify_user_id,clockify_user_role_id,' +
      'allocated_billable,allocated_hours,percent_allocated,duration_start,duration_end'
  );
  if (!allocationsRes.ok) {
    return {
      ok: false,
      message: allocationsRes.message || 'Could not read fos_resource_allocations.',
      fetchedAt: fetchedAt,
      cacheSchemaVersion: RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    };
  }
  if (allocationsRes.truncated) {
    warnings.push('Resource allocation fetch truncated at page cap.');
  }

  var agreementsMap = loadFosAgreementsMetaMap_();
  var companiesMap = loadFosCompaniesMap_();
  var usersMap = loadFosClockifyUsersMap_();
  var rolesMap = loadFosTeamMemberRolesMap_();

  var rawAllocations = [];
  var allocRows = allocationsRes.rows || [];
  for (var i = 0; i < allocRows.length; i++) {
    var row = allocRows[i];
    if (!row || !row.fibery_id) continue;
    rawAllocations.push(mapFosResourceAllocationRowToRaw_(row, agreementsMap, companiesMap, usersMap, rolesMap));
  }

  var rawRows = [];
  for (var j = 0; j < rawAllocations.length; j++) {
    var norm = normalizeResourceAllocationRow_(rawAllocations[j]);
    if (!norm) continue;
    if (!allocationOverlapsRangeYmd_(norm, range.startYmd, range.endYmd)) continue;
    rawRows.push(norm);
  }

  var built = buildResourceAssignmentPersons_(
    rawRows,
    weeks,
    weeklyCapacity,
    range.startYmd,
    range.endYmd,
    warnings
  );
  var laborAgg = aggregateResourceAssignmentLaborByProjectFromSupabase_(
    range.startYmd,
    range.endYmd,
    weeks,
    warnings
  );
  var projects = buildResourceAssignmentProjects_(
    built.persons,
    laborAgg.byProject,
    laborAgg.personMeta,
    laborAgg.projectMeta,
    weeks
  );
  var assignedByDay = aggregateResourceAssignmentAssignedByDay_(
    rawRows,
    weeks,
    weeklyCapacity,
    range.startYmd,
    range.endYmd,
    warnings
  );
  var laborByDay = remapResourceAssignmentLaborByDay_(
    laborAgg.byDay || {},
    laborAgg.personMeta,
    buildResourceAssignmentPersonResolver_(built.persons)
  );
  var personVariances = buildResourceAssignmentPersonVariances_(
    projects,
    assignedByDay,
    laborByDay,
    weeks
  );
  var dimensions = buildResourceAssignmentDimensions_(built.persons, projects);
  var alerts = buildResourceAssignmentAlerts_(built.persons, rawRows, weeks, warnings);
  var kpis = {
    personCount: built.persons.length,
    projectCount: dimensions.projects.length,
    assignmentCount: rawRows.length,
    overAllocatedWeeks: built.overAllocatedWeekCount,
    endingSoonCount: alerts.endingSoonCount,
  };

  return {
    ok: true,
    source: 'supabase',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: RESOURCE_ASSIGNMENTS_CACHE_SCHEMA_VERSION_,
    rangeStart: range.startYmd,
    rangeEnd: range.endYmd,
    weeklyCapacityHours: weeklyCapacity,
    weeks: weeks,
    persons: built.persons,
    projects: projects,
    personVariances: personVariances,
    dimensions: dimensions,
    kpis: kpis,
    alerts: alerts.items,
    warnings: warnings,
    partial: !!allocationsRes.truncated || !!laborAgg.truncated,
    laborMeta: {
      rowCount: laborAgg.rowCount,
      truncated: !!laborAgg.truncated,
      ok: laborAgg.ok !== false,
    },
  };
}

/**
 * Maps one `fos_resource_allocations` row (+ dimension joins) into the raw
 * shape `normalizeResourceAllocationRow_` expects (same shape as one row of
 * `buildResourceAllocationsPortfolioQuery_`).
 *
 * @param {!Object} row
 * @param {!Object} agreementsMap fibery_id -> fos_agreements row
 * @param {!Object} companiesMap fibery_id -> fos_companies row
 * @param {!Object} usersMap fibery_id -> fos_clockify_users row
 * @param {!Object} rolesMap fibery_id -> fos_team_member_roles row
 * @return {!Object}
 * @private
 */
function mapFosResourceAllocationRowToRaw_(row, agreementsMap, companiesMap, usersMap, rolesMap) {
  var agreement = row.agreement_id ? agreementsMap[row.agreement_id] : null;
  var company = agreement && agreement.customer_id ? companiesMap[agreement.customer_id] : null;
  var user = row.clockify_user_id ? usersMap[row.clockify_user_id] : null;
  var role = row.clockify_user_role_id ? rolesMap[row.clockify_user_role_id] : null;
  return {
    id: row.fibery_id,
    duration: { start: row.duration_start, end: row.duration_end },
    allocationName: row.allocation_name,
    percentAllocated: row.percent_allocated,
    clockifyUserId: row.clockify_user_id,
    clockifyUserName: user ? user.name : null,
    clockifyUserCompany: user ? user.company_enum_name : null,
    roleName: role ? role.name : null,
    agreementId: row.agreement_id,
    agreementName: agreement ? agreement.name : null,
    customerName: company ? company.name : null,
    allocatedAndBillable: row.allocated_billable,
    allocatedHours: row.allocated_hours,
  };
}

/**
 * Supabase equivalent of `aggregateResourceAssignmentLaborByProject_`: reads
 * `fos_labor_costs` for the range (via `fetchFosLaborCostsByRange_`) and
 * joins each row back to its agreement (`project_id` -> Clockify project id)
 * and Clockify user (`user_id` -> Clockify numeric id) for plan-vs-actual.
 *
 * @param {string} startYmd
 * @param {string} endYmd
 * @param {!Array<!Object>} weeks
 * @param {!Array<string>} warningsOut
 * @return {!Object}
 * @private
 */
function aggregateResourceAssignmentLaborByProjectFromSupabase_(startYmd, endYmd, weeks, warningsOut) {
  var weekSet = {};
  for (var wi = 0; wi < weeks.length; wi++) {
    weekSet[weeks[wi].key] = true;
  }
  var rangeIso = resourceAssignmentLaborRangeIso_(startYmd, endYmd);
  var fetched = fetchFosLaborCostsByRange_(rangeIso.startIso, rangeIso.endIsoExclusive);
  if (!fetched.ok) {
    warningsOut.push('Labor costs fetch failed for plan vs actual: ' + (fetched.message || 'unknown error'));
    return { ok: false, byProject: {}, byDay: {}, personMeta: {}, projectMeta: {}, rowCount: 0, truncated: false };
  }
  if (fetched.truncated) {
    warningsOut.push('Labor costs fetch truncated; actual hours may be incomplete.');
  }

  var agreementsByProjectId = loadFosAgreementsByClockifyProjectIdMap_();
  var companiesMap = loadFosCompaniesMap_();
  var usersByClockifyId = loadFosClockifyUsersByClockifyIdMap_();
  var rolesMap = loadFosTeamMemberRolesMap_();

  var thresholds = getUtilizationThresholds_();
  var rawRows = [];
  var srcRows = fetched.rows || [];
  for (var i = 0; i < srcRows.length; i++) {
    rawRows.push(
      mapFosLaborCostRowToResourceAssignmentRaw_(
        srcRows[i], agreementsByProjectId, companiesMap, usersByClockifyId, rolesMap
      )
    );
  }
  var rows = normalizeLaborRows_(rawRows, thresholds);
  var byProject = {};
  var byDay = {};
  var personMeta = {};
  var projectMeta = {};

  for (var k = 0; k < rows.length; k++) {
    var r = rows[k];
    var agreementId = r.agreementId ? String(r.agreementId).trim() : '';
    if (!agreementId) continue;
    var weekKey = r.week || extractIsoWeekKey_(r.startDateTime);
    if (!weekKey || !weekSet[weekKey]) continue;
    var personKey = resourceAssignmentPersonKeyFromParts_(r.userId, r.userName);
    if (!byProject[agreementId]) byProject[agreementId] = {};
    if (!byProject[agreementId][personKey]) byProject[agreementId][personKey] = {};
    byProject[agreementId][personKey][weekKey] =
      (byProject[agreementId][personKey][weekKey] || 0) + (r.hours || 0);

    var dayKey = r.day || extractDayKey_(r.startDateTime);
    if (dayKey) {
      if (!byDay[agreementId]) byDay[agreementId] = {};
      if (!byDay[agreementId][personKey]) byDay[agreementId][personKey] = {};
      byDay[agreementId][personKey][dayKey] =
        (byDay[agreementId][personKey][dayKey] || 0) + (r.hours || 0);
    }

    if (!personMeta[personKey]) {
      personMeta[personKey] = {
        name: r.userName || '(Unknown user)',
        personId: r.userId ? String(r.userId).trim() : '',
        roleName: r.userRole || r.clockifyUserRole || '(No role)',
        company: r.clockifyUserCompany || '',
      };
    }
    if (!projectMeta[agreementId]) {
      projectMeta[agreementId] = {
        projectName: r.agreementName || '(Unnamed project)',
        customerName: r.customer || '',
      };
    }
  }

  return {
    ok: true,
    byProject: byProject,
    byDay: byDay,
    personMeta: personMeta,
    projectMeta: projectMeta,
    rowCount: rows.length,
    truncated: !!fetched.truncated,
  };
}

/**
 * Maps a `fos_labor_costs` row for Resource Assignments. Same Datastore
 * customer / role joins as Utilization (`mapFosLaborCostRowToUtilRaw_`).
 *
 * @param {!Object} row
 * @param {!Object} agreementsByProjectId clockify_project_id -> fos_agreements row
 * @param {!Object} companiesMap fibery_id -> fos_companies row
 * @param {!Object} usersByClockifyId clockify_user_id -> fos_clockify_users row
 * @param {!Object} rolesMap fibery_id -> fos_team_member_roles row
 * @return {!Object}
 * @private
 */
function mapFosLaborCostRowToResourceAssignmentRaw_(
  row, agreementsByProjectId, companiesMap, usersByClockifyId, rolesMap
) {
  return mapFosLaborCostRowToUtilRaw_(
    row,
    usersByClockifyId,
    agreementsByProjectId,
    companiesMap,
    rolesMap
  );
}

// ---------------------------------------------------------------------------
// 5. AI Usage Dashboard
// ---------------------------------------------------------------------------

/**
 * Full replace-upsert of essential AI Usage fields from Fibery
 * `Claude API Costs` into `fos_ai_usage_rows` (default lookback window from
 * `AI_USAGE_DASHBOARD_DEFAULT_RANGE_DAYS`). Stores the full Fibery row in the
 * `raw` jsonb column so `buildAiUsagePayloadFromSupabase_` can reuse
 * `normalizeAiUsageRows_` unchanged.
 *
 * @return {!{ ok: true, count: number, truncated: boolean }|!{ ok: false, message: string }}
 */
function mirrorAiUsageRowsFromFibery_() {
  var props = getAiUsageDashboardProps_();
  var now = new Date();
  var range = resolveAiUsageRange_(null, null, now, props.defaultRangeDays);
  var fetched = fetchAllAiUsageRowsChunked_(range.startYmd, range.endYmd, props.maxRows);
  if (!fetched.ok) {
    return { ok: false, message: fetched.message || 'AI usage Fibery fetch failed.' };
  }
  var rows = fetched.rows || [];
  var upserted = 0;
  var batchSize = 200;
  var nowIso = now.toISOString();
  for (var i = 0; i < rows.length; i += batchSize) {
    var batch = rows.slice(i, i + batchSize);
    var mapped = [];
    for (var j = 0; j < batch.length; j++) {
      var d = batch[j];
      if (!d || !d.id) continue;
      mapped.push({
        fibery_id: String(d.id),
        usage_date: aiUsageCoerceYmd_(d.usageDate),
        actor_email: stringOrNull_(d.clockifyUserEmailJoin),
        product: stringOrNull_(d.apiKey) || stringOrNull_(d.model),
        cost_usd: numberOrNull_(d.costUsd) || 0,
        synced_at: nowIso,
        raw: d,
      });
    }
    if (!mapped.length) continue;
    var up = supabaseUpsert_('fos_ai_usage_rows', mapped, 'fibery_id');
    if (!up.ok) {
      return { ok: false, message: up.message || 'fos_ai_usage_rows upsert failed.' };
    }
    upserted += mapped.length;
  }
  return { ok: true, count: upserted, truncated: !!fetched.truncated };
}

/**
 * Builds the AI Usage Dashboard payload from `fos_ai_usage_rows` instead of a
 * live Fibery query. Reuses `normalizeAiUsageRows_` / `buildAiUsageFilterOptions_`
 * / `buildAiUsageAggregates_` unchanged, driven by the `raw` jsonb column.
 *
 * @param {?string=} rangeStart
 * @param {?string=} rangeEnd
 * @return {!Object}
 */
function buildAiUsagePayloadFromSupabase_(rangeStart, rangeEnd) {
  var props = getAiUsageDashboardProps_();
  var now = new Date();
  var fetchedAtIso = now.toISOString();
  var range = resolveAiUsageRange_(rangeStart, rangeEnd, now, props.defaultRangeDays);

  var filters = {
    and: '(usage_date.gte."' + range.startYmd + '",usage_date.lte."' + range.endYmd + '")',
  };
  var fetched = supabaseSelectAll_('fos_ai_usage_rows', filters, 'fibery_id,raw', 'usage_date.desc');
  if (!fetched.ok) {
    return emptyAiUsagePayloadFromSupabase_(
      fetchedAtIso, props, range,
      fetched.message || 'Could not read fos_ai_usage_rows.', fetched.reason
    );
  }

  var rawRows = [];
  var srcRows = fetched.rows || [];
  for (var i = 0; i < srcRows.length; i++) {
    var raw = srcRows[i].raw;
    if (typeof raw === 'string') {
      try {
        raw = JSON.parse(raw);
      } catch (e) {
        raw = null;
      }
    }
    if (raw) {
      rawRows.push(raw);
    }
  }
  if (!rawRows.length) {
    return emptyAiUsagePayloadFromSupabase_(
      fetchedAtIso, props, range,
      'AI usage rows have not been mirrored to Supabase yet. Ask an ADMIN to run Pull from Fibery in Settings.'
    );
  }

  var rows = normalizeAiUsageRows_(rawRows);
  var filterOptions = buildAiUsageFilterOptions_(rows);
  var aggregates = buildAiUsageAggregates_(rows, props.topN);
  var warnings = [];
  if (fetched.truncated) {
    warnings.push('Result paginator hit the page ceiling; data may be incomplete for this range.');
  }

  var payload = {
    ok: true,
    source: 'supabase',
    dataSource: 'claude-api-costs',
    cacheLayer: 'none',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: props.cacheTtlMinutes,
    topN: props.topN,
    range: range,
    rows: rows,
    kpis: aggregates.kpis,
    byDeveloper: aggregates.byDeveloper,
    byProduct: aggregates.byProduct,
    byMonth: aggregates.byMonth,
    filterOptions: filterOptions,
    rollups: {
      window: buildAiUsageRollups_(rows, props.topN),
      sliceRowCount: rows.length,
      cacheRowCount: rows.length,
    },
  };
  if (warnings.length) {
    payload.warnings = warnings;
    payload.partial = true;
  }
  return payload;
}

/**
 * @param {string} fetchedAtIso
 * @param {!Object} props
 * @param {!Object} range
 * @param {string} message
 * @param {string=} reason
 * @return {!Object}
 * @private
 */
function emptyAiUsagePayloadFromSupabase_(fetchedAtIso, props, range, message, reason) {
  var payload = {
    ok: false,
    source: 'supabase',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: AI_USAGE_DASHBOARD_CACHE_SCHEMA_VERSION_,
    ttlMinutes: props.cacheTtlMinutes,
    topN: props.topN,
    range: range,
    rows: [],
    kpis: emptyAiUsageKpis_(),
    filterOptions: { persons: [], roles: [] },
    message: message,
  };
  if (reason) {
    payload.warnings = ['Supabase error: ' + reason];
  }
  return payload;
}

// ---------------------------------------------------------------------------
// 6. Delivery P&L / Portfolio P&L
// ---------------------------------------------------------------------------

/**
 * @param {string} agreementId
 * @return {!{ ok: true, agreement: !Object }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchAgreementContextForPnlFromSupabase_(agreementId) {
  var res = supabaseSelectAll_(
    'fos_agreements',
    { fibery_id: 'eq.' + agreementId },
    'fibery_id,name,total_planned_revenue,rev_recognized,total_labor_costs,total_materials_odc,' +
      'current_margin,target_margin,duration_start,duration_end,execution_date,clockify_project_id'
  );
  if (!res.ok) {
    return { ok: false, reason: res.reason || 'SUPABASE_HTTP', message: res.message || 'fos_agreements query failed.' };
  }
  var row = (res.rows || [])[0];
  if (!row) {
    return { ok: false, reason: 'AGREEMENT_NOT_FOUND', message: 'Agreement not found in Supabase.' };
  }
  return {
    ok: true,
    agreement: {
      id: stringOr_(row.fibery_id, agreementId),
      name: stringOr_(row.name, '(Unnamed project)'),
      plannedRev: numberOr_(row.total_planned_revenue, 0),
      revRec: numberOr_(row.rev_recognized, 0),
      laborCosts: numberOr_(row.total_labor_costs, 0),
      materialsOdc: numberOr_(row.total_materials_odc, 0),
      margin: scaleFractionToPercent_(row.current_margin),
      targetMargin: scaleFractionToPercent_(row.target_margin),
      durStart: stringOrNull_(row.duration_start),
      durEnd: stringOrNull_(row.duration_end),
      executionDate: stringOrNull_(row.execution_date),
      clockifyProjectId: stringOrNull_(row.clockify_project_id),
    },
  };
}

/**
 * @param {string} agreementId
 * @param {boolean} includeProjected
 * @return {!{ ok: true, rows: !Array<!Object> }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchOtherDirectCostsForAgreementFromSupabase_(agreementId, includeProjected) {
  var filters = { agreement_id: 'eq.' + agreementId };
  if (!includeProjected) {
    filters.status_name = 'eq.Actual';
  }
  var res = supabaseSelectAll_(
    'fos_other_direct_costs',
    filters,
    'fibery_id,amount,cost_date,status_name,type_name',
    'cost_date.asc'
  );
  if (!res.ok) {
    return { ok: false, reason: res.reason || 'SUPABASE_HTTP', message: res.message || 'fos_other_direct_costs query failed.' };
  }
  var rows = res.rows || [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push({
      id: stringOr_(r.fibery_id, ''),
      amount: numberOr_(r.amount, 0),
      date: stringOrNull_(r.cost_date),
      status: stringOrNull_(r.status_name),
      type: stringOrNull_(r.type_name),
    });
  }
  return { ok: true, rows: out };
}

/**
 * @param {string} agreementId
 * @return {!{ ok: true, rows: !Array<!Object> }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchRevenueItemsForAgreementFromSupabase_(agreementId) {
  var res = supabaseSelectAll_(
    'fos_revenue_items',
    { agreement_id: 'eq.' + agreementId },
    'fibery_id,name,target_amount,actual_amount,target_date,actual_date,revenue_recognized,state_name',
    'target_date.asc'
  );
  if (!res.ok) {
    return { ok: false, reason: res.reason || 'SUPABASE_HTTP', message: res.message || 'fos_revenue_items query failed.' };
  }
  var rows = res.rows || [];
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    out.push({
      id: stringOr_(r.fibery_id, ''),
      name: stringOr_(r.name, '(Unnamed milestone)'),
      targetAmount: numberOr_(r.target_amount, 0),
      actualAmount: numberOr_(r.actual_amount, 0),
      targetDate: stringOrNull_(r.target_date),
      actualDate: stringOrNull_(r.actual_date),
      recognized: r.revenue_recognized === true,
      state: stringOrNull_(r.state_name),
    });
  }
  return { ok: true, rows: out };
}

/**
 * @param {string} agreementId
 * @return {!{ ok: true, rows: !Array<!Object> }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchResourceAllocationsForAgreementFromSupabase_(agreementId) {
  var res = supabaseSelectAll_(
    'fos_resource_allocations',
    { agreement_id: 'eq.' + agreementId },
    'fibery_id,allocation_name,clockify_user_id,clockify_user_role_id,allocated_cost,' +
      'allocated_hours,percent_allocated,allocated_billable,duration_start,duration_end'
  );
  if (!res.ok) {
    return {
      ok: false, reason: res.reason || 'SUPABASE_HTTP',
      message: res.message || 'fos_resource_allocations query failed.',
    };
  }
  var rows = res.rows || [];
  var usersMap = loadFosClockifyUsersMap_();
  var rolesMap = loadFosTeamMemberRolesMap_();
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var user = r.clockify_user_id ? usersMap[r.clockify_user_id] : null;
    var role = r.clockify_user_role_id ? rolesMap[r.clockify_user_role_id] : null;
    var billableRaw = r.allocated_billable;
    out.push({
      id: stringOr_(r.fibery_id, ''),
      allocatedCost: numberOr_(r.allocated_cost, 0),
      allocatedHours: numberOr_(r.allocated_hours, 0),
      allocationName: stringOrNull_(r.allocation_name),
      clockifyUserName: user ? stringOrNull_(user.name) : null,
      percentAllocated:
        r.percent_allocated != null && r.percent_allocated !== '' ? numberOr_(r.percent_allocated, 0) : null,
      allocatedAndBillable: billableRaw === true ? true : billableRaw === false ? false : null,
      roleName: (role ? stringOrNull_(role.name) : null) || '(No role)',
      durStart: stringOrNull_(r.duration_start),
      durEnd: stringOrNull_(r.duration_end),
    });
  }
  return { ok: true, rows: out };
}

/**
 * @param {string} agreementId
 * @param {number=} limit
 * @return {!{ ok: true, rows: !Array<!Object> }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchStatusUpdatesForAgreementFromSupabase_(agreementId, limit) {
  if (!agreementId) {
    return { ok: false, reason: 'MISSING_AGREEMENT', message: 'Missing agreementId.' };
  }
  var cap = limit > 0 ? limit : resolveStatusUpdatesMaxRows_();
  var res = supabaseSelectAll_(
    'fos_status_updates',
    { agreement_id: 'eq.' + agreementId },
    'fibery_id,agreement_id,status_label,content,author_email,submitted_by,created_at',
    'created_at.desc'
  );
  if (!res.ok) {
    return { ok: false, reason: res.reason || 'SUPABASE_HTTP', message: res.message || 'fos_status_updates query failed.' };
  }
  var rows = (res.rows || []).slice(0, cap);
  var out = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var statusName = stringOrNull_(r.status_label);
    var trafficLight = statusName ? (STATUS_ENUM_TO_TRAFFIC_LIGHT_[statusName] || 'neutral') : 'neutral';
    out.push({
      id: stringOr_(r.fibery_id, ''),
      agreementId: stringOr_(r.agreement_id, agreementId),
      agreementStatus: statusName,
      trafficLight: trafficLight,
      statusColor: null,
      // `author_email` is set by the dual-write path (createAgreementStatusUpdate_);
      // `submitted_by` is set by the AM mirror for bulk-migrated history rows.
      submittedBy: stringOrNull_(r.author_email) || stringOrNull_(r.submitted_by),
      createdAt: stringOrNull_(r.created_at),
      updatePlain: stringOr_(r.content, ''),
      updateSecret: null,
    });
  }
  return { ok: true, rows: out };
}

/**
 * Maps a `fos_labor_costs` row into the shape `buildMonthlyPnL_` expects
 * (`{ id, cost, startDateTime, userRole, clockifyUserRole, clockifyUserCompany }`).
 * Reads typed columns and the `fos_clockify_users` / `fos_team_member_roles`
 * dimension maps. Cost falls back to `hours * team_member_role_cost_rate`,
 * then 0.
 *
 * The `fibery_payload_json` lookups below are retained only for the
 * `PERF_USE_NORMALIZED_LABOR_COLS=false` revert path (feature 047 A1); on the
 * default path `p` is an empty object. Dropping the blob is safe because,
 * measured over all 22,343 mirrored rows on 2026-08-24, none carries
 * `Agreement Management/Cost`, `Cost`, or any role key, and the one key it does
 * carry, `Agreement Management/Time Entry User Name`, is byte-identical to
 * `time_entry_user_name` on every row.
 *
 * @param {!Object} row
 * @param {!Object} usersByClockifyId clockify_user_id -> fos_clockify_users row
 * @param {!Object} rolesMap fibery_id -> fos_team_member_roles row
 * @return {!Object}
 * @private
 */
function mapFosLaborCostRowToDeliveryPnlRaw_(row, usersByClockifyId, rolesMap) {
  row = row || {};
  var p = row.fibery_payload_json;
  if (typeof p === 'string') {
    try {
      p = JSON.parse(p);
    } catch (e) {
      p = null;
    }
  }
  p = p || {};
  var user = null;
  if (row.user_id) {
    var uid = String(row.user_id);
    user = usersByClockifyId[uid] || usersByClockifyId[uid.toLowerCase()] || null;
  }
  var roleFromUser = user && user.team_member_role_id ? rolesMap[user.team_member_role_id] : null;

  var cost = numberOrNull_(p['Agreement Management/Cost']);
  if (cost === null) {
    cost = numberOrNull_(p.Cost);
  }
  if (cost === null) {
    var hours = Number(row.clockify_hours);
    if (!isFinite(hours) && row.seconds != null) {
      hours = Number(row.seconds) / 3600;
    }
    var rate = user ? numberOrNull_(user.team_member_role_cost_rate) : null;
    if (rate === null && roleFromUser) {
      rate = numberOrNull_(roleFromUser.cost_rate);
    }
    cost = isFinite(hours) && rate !== null ? hours * rate : 0;
  }
  var userRole =
    stringOrNull_(p['Agreement Management/User Role']) || (roleFromUser ? roleFromUser.name : null);
  var clockifyUserRole =
    stringOrNull_(p['Agreement Management/Clockify User Role']) ||
    (roleFromUser ? roleFromUser.name : null);
  var clockifyUserCompany =
    stringOrNull_(p['Agreement Management/Clockify User Company']) ||
    (user ? user.company_enum_name : null);
  var hours = Number(row.clockify_hours);
  if (!isFinite(hours) && row.seconds != null) {
    hours = Number(row.seconds) / 3600;
  }
  if (!isFinite(hours)) {
    hours = numberOrNull_(p['Agreement Management/Clockify Hours']);
  }
  if (hours === null || !isFinite(hours) || hours < 0) hours = 0;
  var userName =
    stringOrNull_(row.time_entry_user_name) ||
    stringOrNull_(p['Agreement Management/Time Entry User Name']) ||
    (user && user.name ? String(user.name).trim() : null) ||
    null;
  return {
    id: row.clockify_time_log_id || '',
    cost: cost,
    startDateTime: row.start_date_time || null,
    userName: userName,
    hours: hours,
    userRole: userRole,
    clockifyUserRole: clockifyUserRole,
    clockifyUserCompany: clockifyUserCompany,
  };
}

/**
 * @param {string} agreementId
 * @param {?string} clockifyProjectId
 * @param {number} maxRows Hard cap; `0` = unlimited.
 * @return {!{ ok: true, rows: !Array<!Object>, partial: boolean }|!{ ok: false, reason: string, message: string }}
 * @private
 */
function fetchLaborCostsForAgreementFromSupabase_(agreementId, clockifyProjectId, maxRows) {
  if (!clockifyProjectId) {
    return { ok: true, rows: [], partial: false };
  }
  // Feature 047 A1: swap the `fibery_payload_json` blob for the one typed
  // column the mapper actually needed from it. `Time Entry User Name` was the
  // only key in the blob this path read that is populated, and it matches
  // `time_entry_user_name` on every mirrored row.
  var laborSelect =
    'clockify_time_log_id,start_date_time,clockify_hours,seconds,user_id,time_entry_user_name';
  if (!perfFlag_('PERF_USE_NORMALIZED_LABOR_COLS')) {
    laborSelect += ',fibery_payload_json';
  }
  var fetched = supabaseSelectAll_(
    'fos_labor_costs',
    { project_id: 'eq.' + clockifyProjectId },
    laborSelect,
    'start_date_time.asc'
  );
  if (!fetched.ok) {
    return {
      ok: false,
      reason: fetched.reason || 'SUPABASE_HTTP',
      message: fetched.message || 'fos_labor_costs query failed.',
    };
  }
  var usersByClockifyId = loadFosClockifyUsersByClockifyIdMap_();
  var rolesMap = loadFosTeamMemberRolesMap_();
  var srcRows = fetched.rows || [];
  var out = [];
  var partial = false;
  for (var i = 0; i < srcRows.length; i++) {
    if (maxRows && out.length >= maxRows) {
      partial = true;
      break;
    }
    out.push(mapFosLaborCostRowToDeliveryPnlRaw_(srcRows[i], usersByClockifyId, rolesMap));
  }
  return { ok: true, rows: out, partial: partial || !!fetched.truncated };
}

/**
 * Per-project monthly P&L from Supabase typed tables, replicating
 * `buildDeliveryProjectMonthlyPnLInternal_` (`deliveryDashboard.js`) exactly
 * but reading `fos_agreements` / `fos_revenue_items` / `fos_other_direct_costs`
 * / `fos_labor_costs` / `fos_status_updates` / `fos_resource_allocations`
 * instead of live Fibery queries.
 *
 * @param {string} agreementId
 * @param {!Object=} options `{ portfolioMode: boolean }`
 * @return {!Object}
 */
function buildDeliveryProjectMonthlyPnLFromSupabase_(agreementId, options) {
  options = options || {};
  var portfolioMode = options.portfolioMode === true;
  var fetchedAtIso = new Date().toISOString();
  var emptyShell = {
    ok: false,
    source: 'supabase',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: DELIVERY_PNL_CACHE_SCHEMA_VERSION_,
    agreementId: agreementId || '',
    agreementName: null,
    currency: 'USD',
    months: [],
    laborRoles: [],
    lifetime: emptyLifetime_(),
    discrepancyCheck: emptyDiscrepancy_(),
    partial: false,
    capCounts: { laborRowsRead: 0, laborRowCap: 0 },
    statusUpdates: buildStatusUpdatesBlock_([], true),
    resourceAllocations: emptyResourceAllocationsBlock_(),
  };
  if (!agreementId) {
    emptyShell.message = 'Missing agreementId.';
    return emptyShell;
  }

  var ctx = fetchAgreementContextForPnlFromSupabase_(agreementId);
  if (!ctx.ok) {
    emptyShell.message = ctx.message || 'Could not load agreement context.';
    emptyShell.warnings = [ctx.reason || 'AGREEMENT_CONTEXT_FAILED'];
    return emptyShell;
  }

  var maxLaborRows = resolveMaxLaborRows_();
  var laborFetch = fetchLaborCostsForAgreementFromSupabase_(
    agreementId, ctx.agreement.clockifyProjectId, maxLaborRows
  );
  if (!laborFetch.ok) {
    emptyShell.agreementName = ctx.agreement.name;
    emptyShell.message = laborFetch.message || 'Could not load Labor Costs.';
    emptyShell.warnings = [laborFetch.reason || 'LABOR_FETCH_FAILED'];
    return emptyShell;
  }

  var odcFetch = fetchOtherDirectCostsForAgreementFromSupabase_(agreementId, resolveIncludeProjectedOdc_());
  if (!odcFetch.ok) {
    emptyShell.agreementName = ctx.agreement.name;
    emptyShell.message = odcFetch.message || 'Could not load Other Direct Costs.';
    emptyShell.warnings = [odcFetch.reason || 'ODC_FETCH_FAILED'];
    return emptyShell;
  }

  var revFetch = fetchRevenueItemsForAgreementFromSupabase_(agreementId);
  if (!revFetch.ok) {
    emptyShell.agreementName = ctx.agreement.name;
    emptyShell.message = revFetch.message || 'Could not load Revenue Items.';
    emptyShell.warnings = [revFetch.reason || 'REVENUE_FETCH_FAILED'];
    return emptyShell;
  }

  var statusWarnings = [];
  var statusUpdates = buildStatusUpdatesBlock_([], true);
  if (!portfolioMode) {
    var statusFetch = fetchStatusUpdatesForAgreementFromSupabase_(agreementId);
    if (statusFetch.ok) {
      statusUpdates = buildStatusUpdatesBlock_(statusFetch.rows, true);
    } else {
      statusUpdates = buildStatusUpdatesBlock_([], false);
      statusWarnings.push(statusFetch.reason || 'STATUS_UPDATES_FETCH_FAILED');
    }
  }

  var thresholds = getAgreementThresholds_();
  var built = buildMonthlyPnL_({
    laborRows: laborFetch.rows,
    odcRows: odcFetch.rows,
    revenueRows: revFetch.rows,
    durStart: ctx.agreement.durStart,
    durEnd: ctx.agreement.durEnd,
    targetMarginPct: ctx.agreement.targetMargin,
    lifetimeLabor: ctx.agreement.laborCosts,
    lifetimeExpenses: ctx.agreement.materialsOdc,
    lifetimeMarginPct: ctx.agreement.margin,
    thresholds: thresholds,
  });

  var allocWarnings = [];
  var resourceAllocations = emptyResourceAllocationsBlock_();
  var allocRowsForEnrich = [];
  if (!portfolioMode) {
    var allocFetch = fetchResourceAllocationsForAgreementFromSupabase_(agreementId);
    if (allocFetch.ok) {
      allocRowsForEnrich = allocFetch.rows || [];
      resourceAllocations = buildResourceAllocationsBlock_(
        allocRowsForEnrich, built.months, allocWarnings
      );
    } else {
      allocWarnings.push(allocFetch.reason || 'RESOURCE_ALLOCATIONS_FETCH_FAILED');
    }
    enrichMonthsLaborByPersonWithAllocations_(built.months, allocRowsForEnrich);
  }

  var allWarnings = statusWarnings.concat(allocWarnings);

  var out = {
    ok: true,
    source: 'supabase',
    fetchedAt: fetchedAtIso,
    cacheSchemaVersion: DELIVERY_PNL_CACHE_SCHEMA_VERSION_,
    agreementId: agreementId,
    agreementName: ctx.agreement.name,
    currency: 'USD',
    months: built.months,
    laborRoles: built.laborRoles,
    lifetime: built.lifetime,
    partial: laborFetch.partial,
    capCounts: {
      laborRowsRead: laborFetch.rows.length,
      laborRowCap: maxLaborRows,
    },
    warnings: allWarnings.length ? allWarnings : undefined,
  };
  if (portfolioMode) {
    out.portfolioMode = true;
  } else {
    out.discrepancyCheck = built.discrepancyCheck;
    out.statusUpdates = statusUpdates;
    out.resourceAllocations = resourceAllocations;
    if (typeof buildProjectPerformanceBlock_ === 'function') {
      out.performance = buildProjectPerformanceBlock_({
        months: built.months,
        resourceAllocations: resourceAllocations,
        targetMarginPct: ctx.agreement.targetMargin,
        assignments: resourceAllocations.assignments || [],
      });
    }
  }
  return out;
}

/**
 * Slim monthly P&L for Portfolio aggregation from Supabase (skips status +
 * allocations, matching `buildPortfolioMonthlyPnLInternal_`).
 *
 * @param {string} agreementId
 * @return {!Object}
 */
function buildPortfolioMonthlyPnLFromSupabaseInternal_(agreementId) {
  return buildDeliveryProjectMonthlyPnLFromSupabase_(agreementId, { portfolioMode: true });
}

/**
 * Portfolio P&L bundle from Supabase. Mirrors `buildPortfolioPnlBundleFromFibery_`
 * (`portfolioPnlDashboardCache.js`) but sources the per-project index from
 * `getPortfolioProjectIndex()` (already Supabase-backed via `getDeliveryDashboardData`)
 * and each project's monthly P&L from `buildPortfolioMonthlyPnLFromSupabaseInternal_`.
 *
 * @return {!Object}
 */
function buildPortfolioPnlBundleFromSupabase_() {
  var fetchedAt = new Date().toISOString();
  // Hydrate must not call getPortfolioProjectIndex() (auth + Live getDelivery).
  // Prefer the delivery panel blob just written by agreement hydrate; fall back
  // to deriving active projects from the agreement blob.
  var projects = [];
  var deliveryLoad = loadSupabasePanelPayload_('delivery');
  if (deliveryLoad && deliveryLoad.ok && deliveryLoad.payload && deliveryLoad.payload.projects) {
    projects = filterPortfolioProjects_(deliveryLoad.payload.projects || []);
  } else {
    var agreementLoad = loadSupabasePanelPayload_('agreement');
    if (agreementLoad && agreementLoad.ok && agreementLoad.payload) {
      var derived = buildDeliveryDashboardPayloadFromAgreement_(agreementLoad.payload);
      if (derived && derived.ok !== false) {
        projects = filterPortfolioProjects_(derived.projects || []);
      }
    }
  }
  if (!projects.length) {
    return {
      ok: false,
      source: 'supabase',
      fetchedAt: fetchedAt,
      message:
        'Portfolio project index empty. Run agreement hydrate first so delivery projects exist in Datastore.',
    };
  }
  var pnlById = {};
  var failedIds = [];
  var failedDetails = [];
  for (var i = 0; i < projects.length; i++) {
    var id = projects[i].id;
    try {
      var pnl = buildPortfolioMonthlyPnLFromSupabaseInternal_(id);
      if (pnl && pnl.ok === true) {
        pnlById[id] = pnl;
      } else {
        failedIds.push(id);
        failedDetails.push({
          id: id,
          name: projects[i].name || id,
          message: (pnl && pnl.message) || 'P&L build failed.',
        });
      }
    } catch (e) {
      failedIds.push(id);
      failedDetails.push({
        id: id,
        name: projects[i].name || id,
        message: e && e.message ? e.message : String(e),
      });
    }
  }
  return {
    ok: true,
    source: 'supabase',
    fetchedAt: fetchedAt,
    cacheSchemaVersion: PORTFOLIO_PNL_BUNDLE_CACHE_SCHEMA_VERSION_,
    calendarYear: new Date().getFullYear(),
    projects: projects,
    pnlById: pnlById,
    failedIds: failedIds,
    failedDetails: failedDetails,
    partial: failedIds.length > 0,
    projectCount: projects.length,
    builtCount: Object.keys(pnlById).length,
  };
}
