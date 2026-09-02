"""SQLAlchemy 모델.

create_all이 모든 테이블을 인식하도록 여기서 전부 import 한다.
"""

from app.models.base import Base
from app.models.category import Category
from app.models.collection_job import CollectionJob, JobStatus
from app.models.product import DeliveryType, MonthlyReviewMethod, Product
from app.models.review_snapshot import ReviewSnapshot
from app.models.setting import Setting

__all__ = [
    "Base",
    "Category",
    "CollectionJob",
    "JobStatus",
    "DeliveryType",
    "MonthlyReviewMethod",
    "Product",
    "ReviewSnapshot",
    "Setting",
]
