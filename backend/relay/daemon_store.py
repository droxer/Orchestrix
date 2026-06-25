import sys

from .persistence import daemon_store as _module

sys.modules[__name__] = _module
