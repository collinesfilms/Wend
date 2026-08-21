package locales

import (
	"encoding/json"
	"regexp"
	"sort"
	"strings"
	"testing"
)

// The catalogue is meant to be edited by hand by a translator, so these tests
// guard the two things that break silently: a language left behind when a
// string is added, and a {placeholder} lost or misspelled in translation.

var placeholder = regexp.MustCompile(`\{[a-z_]+\}`)

func sections(t *testing.T) map[string]map[string]map[string]string {
	t.Helper()
	var c catalogue
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatalf("strings.json is not valid JSON: %v", err)
	}
	if len(c.Languages) == 0 {
		t.Fatal(`strings.json declares no "languages"`)
	}
	return map[string]map[string]map[string]string{
		"app":     c.App,
		"errors":  c.Errors,
		"visitor": c.Visitor,
	}
}

func TestEveryStringIsTranslatedIntoEveryLanguage(t *testing.T) {
	var c catalogue
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	for name, section := range sections(t) {
		for key, entry := range section {
			for _, lang := range c.Languages {
				if strings.TrimSpace(entry[lang]) == "" {
					t.Errorf("%s.%q has no %q translation", name, key, lang)
				}
			}
		}
	}
}

func TestPlaceholdersSurviveTranslation(t *testing.T) {
	var c catalogue
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	for name, section := range sections(t) {
		for key, entry := range section {
			want := placeholder.FindAllString(entry[Default], -1)
			sort.Strings(want)
			for _, lang := range c.Languages {
				if lang == Default {
					continue
				}
				got := placeholder.FindAllString(entry[lang], -1)
				sort.Strings(got)
				if strings.Join(got, ",") != strings.Join(want, ",") {
					t.Errorf("%s.%q: %s has placeholders %v, English has %v",
						name, key, lang, got, want)
				}
			}
		}
	}
}

func TestEveryLanguageNamesTwelveMonths(t *testing.T) {
	var c catalogue
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	for _, lang := range c.Languages {
		if n := len(c.Months[lang]); n != 12 {
			t.Errorf("months.%s has %d names, want 12", lang, n)
		}
	}
}

func TestErrorKeysAreTheirOwnEnglish(t *testing.T) {
	// The Go call sites pass the English message as the lookup key, so the two
	// have to stay identical or a refusal silently stops being translated.
	var c catalogue
	if err := json.Unmarshal(raw, &c); err != nil {
		t.Fatal(err)
	}
	for key, entry := range c.Errors {
		if entry[Default] != key {
			t.Errorf("errors[%q] has English %q; the key must be its own English text", key, entry[Default])
		}
	}
}

func TestLookupsFallBackRatherThanFail(t *testing.T) {
	if got := Visitor("fr", "gate.submit"); got == "" || got == "gate.submit" {
		t.Errorf("Visitor(fr, gate.submit) = %q, want the French string", got)
	}
	if got := Visitor("de", "gate.submit"); got != Visitor("en", "gate.submit") {
		t.Errorf("an untranslated language should fall back to English, got %q", got)
	}
	if got := Error("fr", "no such message"); got != "no such message" {
		t.Errorf("an unknown message should pass through, got %q", got)
	}
	if got := Visitor("fr", "expired.body_dated", "date", "3 mai 2026"); !strings.Contains(got, "3 mai 2026") {
		t.Errorf("placeholder not substituted: %q", got)
	}
	if got := Month("fr", 8); got != "août" {
		t.Errorf("Month(fr, 8) = %q, want août", got)
	}
	if !Supported("fr-CA") || Supported("de") {
		t.Error("Supported should normalise regions and reject unknown languages")
	}
}
