import sys

from .persistence import store_common as _module

sys.modules[__name__] = _module
