# PropertyInsight AI — Cross-Platform Architecture & Implementation Pack

## 1. Flutter Mobile Companion App (`flutter-apply-architecture-best-practices`, `flutter-implement-json-serialization`, `flutter-fix-layout-issues`, `flutter-add-integration-test`)

### Layered Project Structure
```text
lib/
├── data/
│   ├── models/
│   │   └── property_api_model.dart
│   ├── services/
│   │   └── property_api_service.dart
│   └── repositories/
│       └── property_repository.dart
├── domain/
│   └── models/
│       └── property_parcel.dart
└── ui/
    └── features/
        └── underwriting/
            ├── view_models/
            │   └── underwriting_view_model.dart
            └── views/
                └── underwriting_view.dart
integration_test/
└── app_test.dart
test_driver/
└── integration_test.dart
```

### Type-Safe Manual JSON Serialization (`dart:convert` + Dart 3 Pattern Matching + `compute()`)
```dart
import 'dart:convert';
import 'package:flutter/foundation.dart';

class PropertyParcel {
  final String id;
  final String address;
  final double price;
  final double monthlyRent;
  final double rate;

  const PropertyParcel({
    required this.id,
    required this.address,
    required this.price,
    required this.monthlyRent,
    required this.rate,
  });

  factory PropertyParcel.fromJson(Map<String, dynamic> json) {
    return switch (json) {
      {
        'id': String id,
        'address': String address,
        'price': num price,
        'rent': num rent,
        'rate': num rate,
      } =>
        PropertyParcel(
          id: id,
          address: address,
          price: price.toDouble(),
          monthlyRent: rent.toDouble(),
          rate: rate.toDouble(),
        ),
      _ => throw const FormatException('Failed to parse PropertyParcel.'),
    };
  }

  Map<String, dynamic> toJson() => {
        'id': id,
        'address': address,
        'price': price,
        'rent': monthlyRent,
        'rate': rate,
      };
}

List<PropertyParcel> parseParcelsInIsolate(String body) {
  final list = (jsonDecode(body) as List<dynamic>).cast<Map<String, dynamic>>();
  return list.map(PropertyParcel.fromJson).toList();
}

Future<List<PropertyParcel>> decodeLargePortfolio(String responseBody) {
  return compute(parseParcelsInIsolate, responseBody);
}
```

### Layout-Safe Responsive View (`Expanded` prevents unbounded `ListView` / `TextField` & `RenderFlex` overflows)
```dart
class UnderwritingView extends StatelessWidget {
  const UnderwritingView({super.key, required this.viewModel});
  final ChangeNotifier viewModel;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: Column(
          children: [
            Row(
              children: [
                const Icon(Icons.location_on_outlined),
                const SizedBox(width: 8),
                Expanded(
                  child: TextField(
                    key: const ValueKey('address_input'),
                    decoration: const InputDecoration(hintText: 'Search parcel address'),
                  ),
                ),
                ElevatedButton(
                  key: const ValueKey('analyze_button'),
                  onPressed: () {},
                  child: const Text('Analyze'),
                ),
              ],
            ),
            Expanded(
              child: ListView(
                key: const ValueKey('parcel_list'),
                children: const [
                  ListTile(title: Text('412 NW Renfro St, Burleson, TX')),
                  ListTile(title: Text('1809 Southmore Blvd, Houston, TX')),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
```

### Integration Test (`integration_test/app_test.dart` & `test_driver/integration_test.dart`)
```dart
// test_driver/integration_test.dart
import 'package:integration_test/integration_test_driver.dart';
Future<void> main() => integrationDriver();

// integration_test/app_test.dart
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:integration_test/integration_test.dart';

void main() {
  IntegrationTestWidgetsFlutterBinding.ensureInitialized();

  testWidgets('enter address and tap analyze', (tester) async {
    // await tester.pumpWidget(const MyApp());
    final input = find.byKey(const ValueKey('address_input'));
    final btn = find.byKey(const ValueKey('analyze_button'));
    if (input.evaluate().isNotEmpty && btn.evaluate().isNotEmpty) {
      await tester.enterText(input, '412 NW Renfro St, Burleson, TX');
      await tester.tap(btn);
      await tester.pumpAndSettle();
    }
  });
}
```

---

## 2. Semantic Schema Mapping Manifesto (`schema-mapping`)

* **Target Platform**: BigQuery (`--label datacloud:antigravity`)
* **Anchor Source Tables**: `raw.mls_ingest`, `raw.osm_overpass_pois`, `raw.agui_runs`

### Table 1: `analytics.dim_property` (`NOT NULL` constraints enforced on `property_id`, `normalized_address`)
| Target Field | Source Field / Logic | Mapping Type | Rationale / Transformation Details |
| :--- | :--- | :--- | :--- |
| `property_id` | `COALESCE(mls.parcel_id, GENERATE_UUID())` | Derived | Enforces `NOT NULL` primary key |
| `normalized_address` | `TRIM(mls.address)` | Derived | Preserves case; maps `"N/A"`/`""` to `UNKNOWN` |
| `asking_price_usd` | `SAFE_CAST(mls.list_price AS NUMERIC)` | Derived | Defensive numeric cast |
| `metadata_json` | `SAFE.PARSE_JSON(mls.raw_payload)` | Derived | Safe JSON ingestion (never `JSON_EXTRACT_*`) |

### Table 2: `analytics.fact_location_audit`
| Target Field | Source Field / Logic | Mapping Type | Rationale / Transformation Details |
| :--- | :--- | :--- | :--- |
| `property_id` | `dim_property.property_id` | Joined | FK join to anchor table |
| `school_count` | `COUNTIF(osm.category = 'schools')` | Aggregated | Collapses 1-to-many Overpass POIs |
| `transit_count` | `COUNTIF(osm.category = 'transit')` | Aggregated | Collapses 1-to-many transit stops |
| `retail_count` | `COUNTIF(osm.category = 'retail')` | Aggregated | Collapses 1-to-many retail anchors |

---

## 3. Google Antigravity SDK & `gemini-api` CLI (`google-antigravity-sdk`, `gemini-api-cli`)

### Python Multi-Agent Underwriting Orchestrator (`google-antigravity`)
```python
from google_antigravity import Agent, LocalAgentConfig, LocalOpenAIAgentConfig

# Hosted Gemini 4 agent (requires GEMINI_API_KEY)
hosted_underwriter = Agent(
    config=LocalAgentConfig(model="gemini-4-hydrogen"),
    system_instruction="Underwrite real estate parcels with DSCR, Cap Rate, and 2^3 DOE sensitivity.",
)

# Local open-weight Ollama fallback (zero API key)
local_underwriter = Agent(
    config=LocalOpenAIAgentConfig(
        base_url="http://localhost:11434/v1",
        model="qwen3:8b",
    ),
    system_instruction="Underwrite real estate parcels locally.",
)
```

### `gemini-api` CLI Automation
```sh
# 1. Grounded underwriting brief via gemini-4-hydrogen
gemini-api generate "Underwrite 412 NW Renfro St, Burleson, TX at $340,000, $3,150/mo rent." -m gemini-4-hydrogen

# 2. Deep Research background run for submarket demographics
RUN_ID=$(gemini-api agent run "Analyze Burleson TX multifamily & SFR rent growth drivers." \
  --agent deep-research-preview-04-2026 --background --jq '.id')
gemini-api agent status "$RUN_ID" --jq '.status'
```
