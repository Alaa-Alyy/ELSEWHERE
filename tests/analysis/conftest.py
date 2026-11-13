import pytest

from p1_corpus import make_corpus


@pytest.fixture(scope="session")
def corpus_dir(tmp_path_factory):
    d = tmp_path_factory.mktemp("corpus")
    make_corpus(d)
    return d
