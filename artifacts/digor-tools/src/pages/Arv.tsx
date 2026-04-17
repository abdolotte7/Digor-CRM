import { useState } from "react";
import { useToolsStatus, useArvConfig, useCalculateArv, useCalculateManualArv } from "@/hooks/use-tools";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";
import { AlertTriangle, Calculator, Check, DollarSign, Home, Maximize, Ruler } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const STREET_SUFFIXES = new Set([
  "ST","AVE","BLVD","DR","LN","CT","RD","WAY","PL","TER","TERR","CIR","HWY",
  "PKWY","PATH","LOOP","SQ","TRL","TRAIL","RUN","PIKE","FWY","ALY","ALLEY",
  "NW","NE","SW","SE","N","S","E","W"
]);

function parseFullAddress(raw: string): { street: string; city: string; state: string; zip: string } | null {
  const trimmed = raw.trim();
  const commaMatch = trimmed.match(/^(.+?),\s*([A-Za-z][A-Za-z\s]*?),\s*([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (commaMatch) {
    return { street: commaMatch[1]!.trim(), city: commaMatch[2]!.trim(), state: commaMatch[3]!.trim().toUpperCase(), zip: commaMatch[4]!.trim() };
  }
  const spaceMatch = trimmed.match(/^(.+)\s+([A-Za-z]{2})\s+(\d{5}(?:-\d{4})?)\s*$/);
  if (spaceMatch) {
    const beforeState = spaceMatch[1]!.trim(), state = spaceMatch[2]!.toUpperCase(), zip = spaceMatch[3]!.trim();
    const parts = beforeState.toUpperCase().split(/\s+/);
    let streetEnd = -1;
    for (let i = parts.length - 1; i >= 1; i--) {
      if (STREET_SUFFIXES.has(parts[i]!)) { streetEnd = i; break; }
    }
    if (streetEnd > 0 && streetEnd < parts.length - 1) {
      const origParts = beforeState.split(/\s+/);
      const street = origParts.slice(0, streetEnd + 1).join(" ");
      const city = origParts.slice(streetEnd + 1).join(" ");
      if (street && city) return { street, city, state, zip };
    }
  }
  return null;
}

export default function ArvCalculator() {
  const { data: status } = useToolsStatus();
  const { data: config } = useArvConfig();
  const calculateArv = useCalculateArv();
  const calculateManual = useCalculateManualArv();

  const [activeTab, setActiveTab] = useState("auto");
  const [result, setResult] = useState<any>(null);

  const [autoForm, setAutoForm] = useState({
    street: "", city: "", state: "", zip: "",
    repairCost: "15000", maxComps: "5", miles: "0.5", excludeDistressed: true
  });

  const handleStreetBlur = () => {
    if (!autoForm.street) return;
    const parsed = parseFullAddress(autoForm.street);
    if (parsed && (!autoForm.city || !autoForm.state)) {
      setAutoForm(prev => ({ ...prev, ...parsed }));
    }
  };

  const handleAutoSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    calculateArv.mutate({
      ...autoForm,
      repairCost: Number(autoForm.repairCost),
      maxComps: Number(autoForm.maxComps),
      miles: Number(autoForm.miles)
    }, {
      onSuccess: (data) => setResult(data)
    });
  };

  const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }).format(val);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">ARV Calculator</h1>
        <p className="text-muted-foreground mt-1">Determine After Repair Value and Maximum Allowable Offer.</p>
      </div>

      {status && !status.attomConfigured && activeTab === "auto" && (
        <Alert variant="destructive" className="bg-destructive/10 border-destructive/20 text-destructive">
          <AlertTriangle className="h-4 w-4" />
          <AlertTitle>Data APIs Not Configured</AlertTitle>
          <AlertDescription>
            Auto mode requires PropertyAPI and ATTOM API keys. Switch to Manual mode to calculate yourself, or configure the API keys.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        <div className="xl:col-span-4">
          <Card className="border-border/50 shadow-sm h-full">
            <CardHeader className="pb-4">
              <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="auto">Auto (DIGOR)</TabsTrigger>
                  <TabsTrigger value="manual">Manual Entry</TabsTrigger>
                </TabsList>
              </Tabs>
            </CardHeader>
            <CardContent>
              {activeTab === "auto" ? (
                <form onSubmit={handleAutoSubmit} className="space-y-4">
                  <div className="space-y-3">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Subject Property</h3>
                    <div className="space-y-2">
                      <Label>Street Address</Label>
                      <Input value={autoForm.street} onChange={e => setAutoForm({...autoForm, street: e.target.value})} onBlur={handleStreetBlur} required placeholder="123 Main St  –  or paste full address" />
                      <p className="text-xs text-muted-foreground">Tip: paste the full address and city/state/zip will auto-fill</p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label>City</Label>
                        <Input value={autoForm.city} onChange={e => setAutoForm({...autoForm, city: e.target.value})} required placeholder="City" />
                      </div>
                      <div className="space-y-2">
                        <Label>State</Label>
                        <Input value={autoForm.state} onChange={e => setAutoForm({...autoForm, state: e.target.value})} required placeholder="CA" maxLength={2} />
                      </div>
                    </div>
                  </div>

                  <div className="space-y-3 pt-4 border-t">
                    <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wider">Assumptions</h3>
                    <div className="space-y-2">
                      <Label>Est. Repair Cost ($)</Label>
                      <Input type="number" value={autoForm.repairCost} onChange={e => setAutoForm({...autoForm, repairCost: e.target.value})} required />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-2">
                        <Label>Radius (Miles)</Label>
                        <Input type="number" step="0.1" value={autoForm.miles} onChange={e => setAutoForm({...autoForm, miles: e.target.value})} />
                      </div>
                      <div className="space-y-2">
                        <Label>Max Comps</Label>
                        <Input type="number" value={autoForm.maxComps} onChange={e => setAutoForm({...autoForm, maxComps: e.target.value})} />
                      </div>
                    </div>
                    <div className="flex items-center justify-between pt-2">
                      <Label htmlFor="distressed" className="cursor-pointer">Exclude Distressed Comps</Label>
                      <Switch id="distressed" checked={autoForm.excludeDistressed} onCheckedChange={c => setAutoForm({...autoForm, excludeDistressed: c})} />
                    </div>
                  </div>

                  <Button type="submit" className="w-full mt-4" disabled={calculateArv.isPending || (!status?.attomConfigured)}>
                    {calculateArv.isPending ? "Calculating..." : "Calculate ARV"}
                  </Button>
                </form>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Calculator className="w-12 h-12 mx-auto mb-4 opacity-20" />
                  <p>Manual entry mode not fully implemented in this demo.</p>
                  <p className="text-sm mt-2">Use Auto mode with a valid API key.</p>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <div className="xl:col-span-8">
          {result ? (
            <div className="space-y-6">
              {/* Top Numbers */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <Card className="bg-primary/10 border-primary/20">
                  <CardContent className="p-6">
                    <div className="text-sm font-medium text-primary mb-1">After Repair Value (ARV)</div>
                    <div className="text-4xl font-bold text-primary tracking-tight">{formatCurrency(result.arv)}</div>
                    <div className="text-sm text-primary/70 mt-2">{formatCurrency(result.arvPricePerSqft)} / sqft</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="text-sm font-medium text-muted-foreground mb-1">MAO (80% Rule)</div>
                    <div className="text-3xl font-bold tracking-tight">{formatCurrency(result.mao)}</div>
                    <div className="text-sm text-muted-foreground mt-2">Includes {formatCurrency(result.repairCost)} repairs</div>
                  </CardContent>
                </Card>
                <Card>
                  <CardContent className="p-6">
                    <div className="text-sm font-medium text-muted-foreground mb-1">Conservative (75% Rule)</div>
                    <div className="text-3xl font-bold tracking-tight">{formatCurrency(result.maxOffer)}</div>
                    <div className="text-sm text-muted-foreground mt-2">Maximum allowable offer</div>
                  </CardContent>
                </Card>
              </div>

              {/* ATTOM AVM secondary valuation */}
              {result.attomAvm && (
                <Card className="border-blue-500/20 bg-blue-500/5">
                  <CardContent className="p-4 flex items-center justify-between gap-4 flex-wrap">
                    <div>
                      <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">ATTOM AVM — Secondary Valuation</p>
                      <p className="text-2xl font-bold text-foreground">{formatCurrency(result.attomAvm.value)}</p>
                      <p className="text-sm text-muted-foreground mt-0.5">
                        Range: {formatCurrency(result.attomAvm.low)} – {formatCurrency(result.attomAvm.high)}
                        {" · "}
                        <span className={result.attomAvm.confidence >= 80 ? "text-green-500" : result.attomAvm.confidence >= 60 ? "text-yellow-500" : "text-red-400"}>
                          Confidence: {result.attomAvm.confidence}%
                        </span>
                      </p>
                    </div>
                    <div className="text-right text-sm text-muted-foreground">
                      <p>vs Comp-Based ARV</p>
                      {(() => {
                        const diff = result.attomAvm.value - result.arv;
                        const pct = ((diff / result.arv) * 100).toFixed(1);
                        return (
                          <p className={`font-semibold text-base ${diff >= 0 ? "text-green-500" : "text-red-400"}`}>
                            {diff >= 0 ? "+" : ""}{formatCurrency(diff)} ({diff >= 0 ? "+" : ""}{pct}%)
                          </p>
                        );
                      })()}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Data source note */}
              <div className={`text-xs bg-muted/30 border rounded-lg px-3 py-2 flex gap-2 items-start ${result.subjectSqftSource?.includes("ATTOM") ? "border-green-500/20 text-green-400/80" : "border-yellow-500/20 text-yellow-400/80"}`}>
                {result.subjectSqftSource?.includes("ATTOM") ? (
                  <Check className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                ) : (
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                )}
                <span>
                  <span className="font-medium">Sqft source: {result.subjectSqftSource || "PropertyAPI"}.</span>{" "}
                  {result.subjectSqftSource?.includes("ATTOM")
                    ? "Subject and comp sqft both use ATTOM universalsize (heated living area) — adjustments are apples-to-apples."
                    : "Could not retrieve subject sqft from ATTOM — using PropertyAPI full building sqft instead, which may inflate adjustments vs. comps."}
                </span>
              </div>

              {/* Comps Table */}
              <Card>
                <CardHeader>
                  <CardTitle>Comparable Sales Used ({result.compsUsed})</CardTitle>
                  <CardDescription>Multi-family and oversized comps are automatically filtered out</CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="rounded-md border">
                    <Table>
                      <TableHeader>
                        <TableRow className="bg-muted/50">
                          <TableHead>Address</TableHead>
                          <TableHead className="text-right">Specs</TableHead>
                          <TableHead className="text-right">Sold Date</TableHead>
                          <TableHead className="text-right">Sold Price</TableHead>
                          <TableHead className="text-right">Time Adj.</TableHead>
                          <TableHead className="text-right">Adj. Price</TableHead>
                          <TableHead className="text-right">Distance</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {result.comps.map((comp: any, i: number) => {
                          const soldMonths = comp.saleDate
                            ? Math.floor((Date.now() - new Date(comp.saleDate).getTime()) / (1000 * 60 * 60 * 24 * 30.5))
                            : null;
                          const dateColor = soldMonths == null ? "" : soldMonths > 18 ? "text-red-400" : soldMonths > 12 ? "text-yellow-400" : "text-green-500";
                          const timeAdj = comp.adjustments?.time ?? 0;
                          return (
                            <TableRow key={i}>
                              <TableCell className="font-medium">{comp.address}</TableCell>
                              <TableCell className="text-right text-muted-foreground text-sm">
                                {comp.beds}b / {comp.baths}ba / {comp.sqft?.toLocaleString()}sqft
                              </TableCell>
                              <TableCell className={`text-right text-sm ${dateColor}`}>
                                {comp.saleDate || "—"}
                                {soldMonths != null && soldMonths > 18 && <span className="ml-1 text-xs">⚠</span>}
                              </TableCell>
                              <TableCell className="text-right">{formatCurrency(comp.salePrice)}</TableCell>
                              <TableCell className={`text-right text-sm ${timeAdj > 0 ? "text-green-500" : "text-muted-foreground"}`}>
                                {timeAdj > 0 ? `+${formatCurrency(timeAdj)}` : "—"}
                              </TableCell>
                              <TableCell className="text-right font-medium text-primary">{formatCurrency(comp.adjustedPrice)}</TableCell>
                              <TableCell className="text-right text-muted-foreground">{comp.distanceMiles} mi</TableCell>
                            </TableRow>
                          );
                        })}
                      </TableBody>
                    </Table>
                  </div>
                </CardContent>
              </Card>
            </div>
          ) : (
            <Card className="h-full min-h-[400px] flex items-center justify-center border-dashed border-2 bg-muted/5">
              <div className="text-center text-muted-foreground">
                <Home className="w-16 h-16 mx-auto mb-4 opacity-20" />
                <h3 className="text-lg font-medium text-foreground">No Calculation Yet</h3>
                <p className="mt-1 max-w-sm mx-auto text-sm">Enter property details on the left to generate an ARV calculation and comp analysis.</p>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
