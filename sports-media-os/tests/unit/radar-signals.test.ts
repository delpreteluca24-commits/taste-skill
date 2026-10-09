import { describe, expect, it } from "vitest";

import {
  detectEventSignals,
  detectTextSignals,
  detectVelocitySignal,
  RADAR_SIGNALS,
  SIGNAL_LABELS,
  sortSignals,
  TEXT_SIGNALS,
  type RadarSignal,
} from "@/lib/radar/signals";

const signalsOf = (...texts: string[]) => detectTextSignals(...texts).signals;
const termsOf = (signal: RadarSignal, ...texts: string[]) => detectTextSignals(...texts).matches.find((m) => m.signal === signal)?.terms ?? [];

describe("radar text signals — English", () => {
  it.each<[string, RadarSignal, string[]]>([
    ["Bologna stun Inter in shock win at San Siro", "upset", ["shock win", "stun"]],
    ["Underdogs Girona upset Real Madrid", "upset", ["underdogs", "upset"]],
    ["Haaland breaks all-time Premier League scoring record", "record", ["all-time", "record"]],
    ["Sinner becomes the first ever Italian to win in Shanghai", "record", ["first ever"]],
    ["Derby day: Inter and Milan meet again", "rivalry", ["derby"]],
    ["El Clásico preview: Real Madrid vs Barcelona", "rivalry", ["el clasico"]],
    ["VAR controversy after disallowed goal", "controversy", ["controversy", "disallowed", "var"]],
    ["Star handed three-match ban for red card", "controversy", ["ban"]],
    ["Mourinho slams referees after defeat", "statement", ["slams"]],
    ["Klopp says the title race is over", "statement", ["says"]],
    ["Five straight wins: Arsenal unbeaten since August", "unusual_stat", ["five straight", "straight wins", "unbeaten"]],
    ["Most goals in 10 games since 1992", "unusual_stat", ["most"]],
    ["Third win in a row for Napoli", "unusual_stat", ["in a row"]],
    ["Striker ruled out for six weeks with hamstring injury", "injury", ["hamstring", "injury", "ruled out"]],
    ["Here we go: Chelsea sign winger, medical booked", "transfer", ["here we go", "medical", "sign"]],
    ["Breaking: coach sacked after board meeting", "breaking", ["breaking"]],
    ["Club confirmed the decision officially", "breaking", ["confirmed", "officially"]],
  ])("%s → %s", (text, signal, terms) => {
    expect(signalsOf(text)).toContain(signal);
    expect(termsOf(signal, text)).toEqual(terms);
  });
});

describe("radar text signals — Italian", () => {
  it.each<[string, RadarSignal, string[]]>([
    ["Clamoroso al Maradona: il Napoli cade in casa", "upset", ["clamoroso"]],
    ["Colpaccio del Lecce a Torino", "upset", ["colpaccio"]],
    ["Risultato storico per l'Italia del tennis", "record", ["storico"]],
    ["Per la prima volta nella storia la Juve perde cinque gare", "record", ["nella storia", "per la prima volta"]],
    ["Derby della Madonnina, vigilia di tensione", "rivalry", ["derby"]],
    ["Polemica arbitrale: squalifica di due giornate per l'allenatore", "controversy", ["polemica", "squalifica"]],
    ["Moviola: il VAR annulla il gol", "controversy", ["moviola", "var"]],
    ["Allegri attacca la società: «Serve chiarezza»", "statement", ["attacca"]],
    ["Il tecnico ammette: abbiamo sbagliato", "statement", ["ammette"]],
    ["Cinque vittorie di fila, Atalanta imbattuta", "unusual_stat", ["di fila", "imbattuta"]],
    ["Infortunio per Leão: lesione al flessore", "injury", ["infortunio", "lesione"]],
    ["Calciomercato, è ufficiale: Rossi al Milan in prestito", "transfer", ["calciomercato", "prestito"]],
  ])("%s → %s", (text, signal, terms) => {
    expect(signalsOf(text)).toContain(signal);
    expect(termsOf(signal, text)).toEqual(terms);
  });

  it("matches without accents and with typographic apostrophes", () => {
    expect(termsOf("breaking", "È UFFICIALE: rinnovo fino al 2029")).toEqual(["ufficiale"]);
    expect(termsOf("breaking", "Ultim’ora dal ritiro azzurro")).toEqual(["ultim'ora"]);
    expect(signalsOf("Rivalità infinita tra Roma e Lazio")).toContain("rivalry");
  });
});

describe("radar text signals — precision", () => {
  it("returns nothing for ordinary text", () => {
    expect(detectTextSignals("Weather forecast for the weekend")).toEqual({ signals: [], matches: [] });
    expect(detectTextSignals("", null, undefined)).toEqual({ signals: [], matches: [] });
  });

  it("does not confuse look-alike words", () => {
    expect(signalsOf("Match recorded in front of fans")).not.toContain("record");
    expect(signalsOf("Third win in a row")).not.toContain("controversy");
    expect(signalsOf("The most important match of the season")).not.toContain("unusual_stat");
    expect(signalsOf("Variazione di programma")).not.toContain("controversy");
  });

  it("uses title and summary together, in canonical enum order", () => {
    const d = detectTextSignals("Derby shock", "The coach slams the referee after VAR drama");
    expect(d.signals).toEqual(["upset", "rivalry", "controversy", "statement"]);
    expect(d.signals).toEqual(sortSignals(d.signals));
  });

  it("every text signal has a label and is a radar_signal enum value", () => {
    for (const s of TEXT_SIGNALS) {
      expect(RADAR_SIGNALS).toContain(s);
      expect(SIGNAL_LABELS[s]).toBeTruthy();
    }
  });
});

describe("event and velocity signals", () => {
  const now = new Date("2026-10-08T12:00:00Z");

  it("upcoming_event for scheduled events within 72h and for live events", () => {
    expect(detectEventSignals({ status: "scheduled", starts_at: "2026-10-08T22:00:00Z", ends_at: null }, now)).toEqual([
      { signal: "upcoming_event", terms: ["starts in 10h"] },
    ]);
    expect(detectEventSignals({ status: "live", starts_at: "2026-10-08T11:00:00Z", ends_at: null }, now)[0]).toMatchObject({
      signal: "upcoming_event",
      terms: ["live now"],
    });
    expect(detectEventSignals({ status: "scheduled", starts_at: "2026-10-12T12:00:00Z", ends_at: null }, now)).toEqual([]);
    expect(detectEventSignals({ status: "cancelled", starts_at: "2026-10-08T22:00:00Z", ends_at: null }, now)).toEqual([]);
  });

  it("just_finished for events that ended in the last 24h (start time when the end is unknown)", () => {
    expect(detectEventSignals({ status: "finished", starts_at: "2026-10-08T07:00:00Z", ends_at: "2026-10-08T09:00:00Z" }, now)).toEqual([
      { signal: "just_finished", terms: ["finished 3h ago"] },
    ]);
    expect(detectEventSignals({ status: "finished", starts_at: "2026-10-08T02:00:00Z", ends_at: null }, now)[0]?.signal).toBe("just_finished");
    expect(detectEventSignals({ status: "finished", starts_at: "2026-10-06T10:00:00Z", ends_at: "2026-10-06T12:00:00Z" }, now)).toEqual([]);
    expect(detectEventSignals(null, now)).toEqual([]);
  });

  it("rising_trend needs ≥ 2 sources in the last 6h and more than the previous 6h", () => {
    expect(detectVelocitySignal(3, 1)?.signal).toBe("rising_trend");
    expect(detectVelocitySignal(2, 0)?.terms[0]).toMatch(/2 sources in the last 6h vs 0/);
    expect(detectVelocitySignal(1, 0)).toBeNull();
    expect(detectVelocitySignal(2, 2)).toBeNull();
  });
});
