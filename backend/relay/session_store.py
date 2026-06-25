import sys

from .persistence import session_store as _module

sys.modules[__name__] = _module
