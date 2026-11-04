from clipforge.models import Word
from clipforge.snap import ends_sentence, is_filler, snap
from tests.conftest import make_words


def words_of(text):
    return make_words(text, start=0.0, word_s=0.4, gap=0.1)  # 0.5 s per word


def test_skips_leading_fillers():
    w = words_of("allora ehm il punto è che nessuno risparmia. poi altro.")
    s = snap(w, 0.0, 4.4, "it", min_s=1, max_s=10)
    assert w[s.first].text == "il"
    assert s.start >= w[1].end  # padding never swallows the filler before


def test_ends_on_sentence_end_backward():
    w = words_of("questa è la prima frase. questa è la seconda frase che continua senza")
    s = snap(w, 0.0, w[-1].end, "it", min_s=1, max_s=10)
    assert w[s.last].text == "frase."


def test_extends_forward_to_sentence_end():
    w = words_of("uno due tre quattro cinque sei sette otto.")
    s = snap(w, 0.0, 1.9, "it", min_s=1, max_s=10)  # LLM cut at "quattro"
    assert w[s.last].text == "otto."


def test_caps_at_max():
    w = words_of(" ".join(["parola"] * 20) + " fine. " + " ".join(["altra"] * 20) + " fine.")
    s = snap(w, 0.0, w[-1].end, "it", min_s=2, max_s=12)
    assert s.end - s.start <= 12 + 0.5
    assert w[s.last].text == "fine."


def test_none_when_too_short():
    w = words_of("ciao. fine.")
    assert snap(w, 0.0, w[-1].end, "it", min_s=20, max_s=60) is None


def test_padding_stays_in_silence():
    w = [Word(start=0, end=1, text="prima."), Word(start=1.05, end=2, text="Ecco"),
         Word(start=2.1, end=3, text="tutto."), Word(start=3.1, end=4, text="dopo")]
    s = snap(w, 1.05, 3.0, "it", min_s=1, max_s=10)
    assert 1.0 <= s.start <= 1.05
    assert 3.0 <= s.end < 3.1


def test_helpers():
    assert is_filler(Word(start=0, end=1, text="Allora,"), "it")
    assert is_filler(Word(start=0, end=1, text="So"), "en")
    assert not is_filler(Word(start=0, end=1, text="Soldi"), "it")
    assert ends_sentence(Word(start=0, end=1, text="davvero?!"))
    assert ends_sentence(Word(start=0, end=1, text='fine."'))
    assert not ends_sentence(Word(start=0, end=1, text="quindi,"))
