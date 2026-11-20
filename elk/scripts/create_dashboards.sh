#!/bin/bash
KIBANA="http://localhost:5601"
H="Content-Type: application/json"
K="kbn-xsrf: true"

declare -A VIZ_IDS

echo "=== Creating Traffic visualizations ==="

# 1. Top Applications (Pie)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Top Applications","visState":"{\"title\":\"Top Applications\",\"type\":\"pie\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"segment\",\"params\":{\"field\":\"application\",\"size\":15,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"20e81cb5-68ed-41ee-a112-51e76a27cad2"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["top_apps"]=$ID
echo "Top Applications: $ID"

# 2. Top Source IPs (Table)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Top Source IPs","visState":"{\"title\":\"Top Source IPs\",\"type\":\"table\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"sum\",\"schema\":\"metric\",\"params\":{\"field\":\"bytes\"}},{\"id\":\"3\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"bucket\",\"params\":{\"field\":\"src_ip\",\"size\":20,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"20e81cb5-68ed-41ee-a112-51e76a27cad2"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["top_src_ips"]=$ID
echo "Top Source IPs: $ID"

# 3. Bytes Over Time (Area)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Traffic Bytes Over Time","visState":"{\"title\":\"Traffic Bytes Over Time\",\"type\":\"area\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"sum\",\"schema\":\"metric\",\"params\":{\"field\":\"bytes\"}},{\"id\":\"2\",\"enabled\":true,\"type\":\"date_histogram\",\"schema\":\"segment\",\"params\":{\"field\":\"@timestamp\",\"interval\":\"auto\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"20e81cb5-68ed-41ee-a112-51e76a27cad2"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["bytes_time"]=$ID
echo "Bytes Over Time: $ID"

# 4. Action Distribution (Pie)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Action Distribution","visState":"{\"title\":\"Action Distribution\",\"type\":\"pie\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"segment\",\"params\":{\"field\":\"action\",\"size\":10,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"20e81cb5-68ed-41ee-a112-51e76a27cad2"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["action_dist"]=$ID
echo "Action Distribution: $ID"

# 5. Zone Flow (Heatmap)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Zone Traffic Flow","visState":"{\"title\":\"Zone Traffic Flow\",\"type\":\"heatmap\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"segment\",\"params\":{\"field\":\"src_zone\",\"size\":10,\"order\":\"desc\",\"orderBy\":\"1\"}},{\"id\":\"3\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"group\",\"params\":{\"field\":\"dst_zone\",\"size\":10,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"20e81cb5-68ed-41ee-a112-51e76a27cad2"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["zone_flow"]=$ID
echo "Zone Flow: $ID"

# 6. Top Rules Hit (Bar)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Top Rules Hit","visState":"{\"title\":\"Top Rules Hit\",\"type\":\"horizontal_bar\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"segment\",\"params\":{\"field\":\"rule\",\"size\":15,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"20e81cb5-68ed-41ee-a112-51e76a27cad2"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["top_rules"]=$ID
echo "Top Rules: $ID"

echo ""
echo "=== Creating Threat visualizations ==="

# 7. Threat Severity (Pie)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Threat Severity Distribution","visState":"{\"title\":\"Threat Severity Distribution\",\"type\":\"pie\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"segment\",\"params\":{\"field\":\"severity\",\"size\":10,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ea6e6c3c-4909-443d-a70f-4e193f7c121a"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["threat_severity"]=$ID
echo "Threat Severity: $ID"

# 8. Threat Events Over Time (Bar)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Threat Events Over Time","visState":"{\"title\":\"Threat Events Over Time\",\"type\":\"histogram\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"date_histogram\",\"schema\":\"segment\",\"params\":{\"field\":\"@timestamp\",\"interval\":\"auto\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ea6e6c3c-4909-443d-a70f-4e193f7c121a"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["threat_time"]=$ID
echo "Threat Events Over Time: $ID"

# 9. Top Threat Categories (Horizontal Bar)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Top Threat Categories","visState":"{\"title\":\"Top Threat Categories\",\"type\":\"horizontal_bar\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"segment\",\"params\":{\"field\":\"category\",\"size\":15,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ea6e6c3c-4909-443d-a70f-4e193f7c121a"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["threat_categories"]=$ID
echo "Threat Categories: $ID"

# 10. Top Attacked Destinations (Table)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Top Attacked Destinations","visState":"{\"title\":\"Top Attacked Destinations\",\"type\":\"table\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"bucket\",\"params\":{\"field\":\"dst_ip\",\"size\":20,\"order\":\"desc\",\"orderBy\":\"1\"}},{\"id\":\"3\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"bucket\",\"params\":{\"field\":\"severity\",\"size\":5,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"ea6e6c3c-4909-443d-a70f-4e193f7c121a"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["attacked_dst"]=$ID
echo "Attacked Destinations: $ID"

echo ""
echo "=== Creating System & GP visualizations ==="

# 11. System Events by Severity (Bar)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"System Events by Severity","visState":"{\"title\":\"System Events by Severity\",\"type\":\"histogram\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"segment\",\"params\":{\"field\":\"severity_level\",\"size\":10,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"8ed53cc5-74b0-412a-8481-48dbf709b87e"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["sys_severity"]=$ID
echo "System Severity: $ID"

# 12. System Events Over Time
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"System Events Over Time","visState":"{\"title\":\"System Events Over Time\",\"type\":\"histogram\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"date_histogram\",\"schema\":\"segment\",\"params\":{\"field\":\"@timestamp\",\"interval\":\"auto\"}},{\"id\":\"3\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"group\",\"params\":{\"field\":\"severity_level\",\"size\":5,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"8ed53cc5-74b0-412a-8481-48dbf709b87e"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["sys_time"]=$ID
echo "System Over Time: $ID"

# 13. GP Sessions Over Time
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"GlobalProtect Sessions Over Time","visState":"{\"title\":\"GlobalProtect Sessions Over Time\",\"type\":\"histogram\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"date_histogram\",\"schema\":\"segment\",\"params\":{\"field\":\"@timestamp\",\"interval\":\"auto\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"f66902ba-9fde-4774-8650-4c031ad6afb3"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["gp_sessions"]=$ID
echo "GP Sessions: $ID"

# 14. Top GP Users (Table)
ID=$(curl -s -X POST "$KIBANA/api/saved_objects/visualization" \
  -H "$H" -H "$K" \
  -d '{"attributes":{"title":"Top GP Users","visState":"{\"title\":\"Top GP Users\",\"type\":\"table\",\"aggs\":[{\"id\":\"1\",\"enabled\":true,\"type\":\"count\",\"schema\":\"metric\",\"params\":{}},{\"id\":\"2\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"bucket\",\"params\":{\"field\":\"username\",\"size\":20,\"order\":\"desc\",\"orderBy\":\"1\"}},{\"id\":\"3\",\"enabled\":true,\"type\":\"terms\",\"schema\":\"bucket\",\"params\":{\"field\":\"stage\",\"size\":5,\"order\":\"desc\",\"orderBy\":\"1\"}}]}","uiStateJSON":"{}","description":"","kibanaSavedObjectMeta":{"searchSourceJSON":"{\"query\":{\"query\":\"\",\"language\":\"kuery\"},\"filter\":[],\"indexRefName\":\"kibanaSavedObjectMeta.searchSourceJSON.index\"}"}},"references":[{"name":"kibanaSavedObjectMeta.searchSourceJSON.index","type":"index-pattern","id":"f66902ba-9fde-4774-8650-4c031ad6afb3"}]}' \
  | python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('id','ERR'))")
VIZ_IDS["top_gp_users"]=$ID
echo "Top GP Users: $ID"

echo ""
echo "=== Printing all IDs for dashboard creation ==="
for key in "${!VIZ_IDS[@]}"; do
  echo "$key=${VIZ_IDS[$key]}"
done
