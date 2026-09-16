  // ---- Configuration: field API names ----
  var DEAL_FIELDS = ["Brief_No", "Area_of_Interest", "Estimated_Budget", "Purchase_Type"];
  var SUBFORM_API_NAME = "Search_Criteria_Options";
  var SUBFORM_FIELDS = ["Suburbs", "Option_Notes", "Special_Criteria"];
  var PER_PAGE = 200;
  var MAX_PAGES = 10; // safety cap: 10 x 200 = 2000 deals
  var SUBFORM_CONCURRENCY = 5; // how many per-record subform fetches to run at once

  var EXCLUDED_STAGES = ["Closed-Lost to Competition", "Closed Lost", "Settlement"];
  var EXCLUDED_TAG_NAME = "On Hold";

  var allDeals = [];

  function setStatus(text) {
    document.getElementById("status").textContent = text;
  }

  function escapeHtml(str) {
    if (str === null || str === undefined) return "";
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }

  // Multi-select picklists come back from the API as an array of strings.
  function formatMultiSelect(value) {
    if (value === null || value === undefined) return "-";
    if (Array.isArray(value)) {
      if (value.length === 0) return "-";
      return escapeHtml(value.join(", "));
    }
    return escapeHtml(value);
  }

  // Excludes deals in a closed-out stage, or tagged "On Hold".
  function shouldIncludeDeal(deal) {
    if (EXCLUDED_STAGES.indexOf(deal.Stage) !== -1) {
      return false;
    }
    var tags = deal.Tag || [];
    var hasExcludedTag = tags.some(function (tag) {
      return tag && tag.name === EXCLUDED_TAG_NAME;
    });
    return !hasExcludedTag;
  }

  // Fetch one page of Deals with all fields.
  // Note: the Zoho CRM API only includes subform data when a SPECIFIC record is
  // fetched by ID - it is never included in this kind of bulk/list call, even
  // though every other field comes through fine. See fetchSubformsForDeals below.
  function fetchDealsPage(page) {
    return ZOHO.CRM.API.getAllRecords({
      Entity: "Deals",
      sort_order: "desc",
      sort_by: "Modified_Time",
      per_page: PER_PAGE,
      page: page
    });
  }

  function loadAllDeals() {
    setStatus("Loading...");
    document.getElementById("errorState") && document.getElementById("errorState").remove();
    allDeals = [];

    function loadPage(page) {
      fetchDealsPage(page).then(function (response) {
        var records = (response && response.data) ? response.data : [];
        allDeals = allDeals.concat(records);

        var moreRecords = response && response.info && response.info.more_records;
        if (moreRecords && page < MAX_PAGES) {
          loadPage(page + 1);
        } else {
          allDeals = allDeals.filter(shouldIncludeDeal);
          setStatus("Loading search criteria for " + allDeals.length + " deal(s)...");
          fetchSubformsForDeals(allDeals).then(function () {
            setStatus(allDeals.length + " deal(s) loaded");
            render(allDeals);
          });
        }
      }, function (error) {
        console.error("Failed to fetch Deals:", error);
        setStatus("Error loading data");
        showError("Could not load Deals. Check the browser console for details, and confirm the field API names (Brief_No, Area_of_Interest, Estimated_Budget, Purchase_Type, Search_Criteria_Options) are correct.");
      });
    }

    loadPage(1);
  }

  // Fetches each deal's full record individually (in small concurrent batches)
  // purely to pull its subform data, and merges it back onto the deal objects
  // already loaded via the list call above.
  function fetchSubformsForDeals(deals) {
    var index = 0;

    function runNextBatch() {
      var batch = deals.slice(index, index + SUBFORM_CONCURRENCY);
      index += SUBFORM_CONCURRENCY;

      if (batch.length === 0) {
        return Promise.resolve();
      }

      var batchPromises = batch.map(function (deal) {
        return ZOHO.CRM.API.getRecord({ Entity: "Deals", RecordID: deal.id }).then(
          function (response) {
            var fullRecord = response && response.data && response.data[0];
            deal[SUBFORM_API_NAME] = fullRecord ? (fullRecord[SUBFORM_API_NAME] || []) : [];
          },
          function (error) {
            console.error("Failed to fetch subform for deal " + deal.id + ":", error);
            deal[SUBFORM_API_NAME] = [];
          }
        );
      });

      return Promise.all(batchPromises).then(runNextBatch);
    }

    return runNextBatch();
  }

  function showError(message) {
    var content = document.getElementById("content");
    content.innerHTML = '<div id="errorState">' + escapeHtml(message) + '</div>';
  }

  function buildSubformTable(subformRows) {
    if (!subformRows || subformRows.length === 0) {
      return '<div class="empty-subform">No search criteria options on this deal</div>';
    }
    var rowsHtml = subformRows.map(function (row) {
      return "<tr>" +
        "<td>" + escapeHtml(row.Suburbs) + "</td>" +
        "<td>" + escapeHtml(row.Option_Notes) + "</td>" +
        "<td>" + escapeHtml(row.Special_Criteria) + "</td>" +
        "</tr>";
    }).join("");

    return '<table class="subform">' +
      "<thead><tr><th>Suburbs</th><th>Option Notes</th><th>Special Criteria</th></tr></thead>" +
      "<tbody>" + rowsHtml + "</tbody>" +
      "</table>";
  }

  function buildDealCard(deal) {
    var subformRows = deal[SUBFORM_API_NAME] || [];

    var areaOfInterestText = Array.isArray(deal.Area_of_Interest) ? deal.Area_of_Interest.join(" ") : (deal.Area_of_Interest || "");
    return '<div class="deal-card" data-search="' +
      escapeHtml((deal.Brief_No || "") + " " + areaOfInterestText).toLowerCase() +
      '">' +
      '<div class="deal-header">' +
        '<div class="field"><div class="field-label">Brief No</div><div class="field-value">' + escapeHtml(deal.Brief_No || "-") + '</div></div>' +
        '<div class="field"><div class="field-label">Area of Interest</div><div class="field-value">' + formatMultiSelect(deal.Area_of_Interest) + '</div></div>' +
        '<div class="field"><div class="field-label">Estimated Budget</div><div class="field-value">' + escapeHtml(deal.Estimated_Budget || "-") + '</div></div>' +
        '<div class="field"><div class="field-label">Purchase Type</div><div class="field-value">' + escapeHtml(deal.Purchase_Type || "-") + '</div></div>' +
      '</div>' +
      buildSubformTable(subformRows) +
      '</div>';
  }

  function render(deals) {
    var content = document.getElementById("content");

    if (!deals || deals.length === 0) {
      content.innerHTML = '<div id="emptyState">No deals found.</div>';
      return;
    }

    content.innerHTML = deals.map(buildDealCard).join("");
  }

  function applyFilter() {
    var term = document.getElementById("searchBox").value.trim().toLowerCase();
    if (!term) {
      render(allDeals);
      return;
    }
    var filtered = allDeals.filter(function (deal) {
      var areaOfInterestText = Array.isArray(deal.Area_of_Interest) ? deal.Area_of_Interest.join(" ") : (deal.Area_of_Interest || "");
      var haystack = ((deal.Brief_No || "") + " " + areaOfInterestText).toLowerCase();
      return haystack.indexOf(term) !== -1;
    });
    render(filtered);
    setStatus(filtered.length + " of " + allDeals.length + " deal(s)");
  }

  document.getElementById("searchBox").addEventListener("input", applyFilter);
  document.getElementById("refreshBtn").addEventListener("click", loadAllDeals);

  // ---- Widget bootstrap ----
  // Note: WebTab widgets aren't tied to a specific record, so the "PageLoad"
  // event (which fires for entity detail pages) is not reliable here.
  // Load data directly once the SDK is ready instead.
  ZOHO.embeddedApp.init().then(function () {
    loadAllDeals();
  });
