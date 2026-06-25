import sys

from .services import daemon as _module

sys.modules[__name__] = _module
