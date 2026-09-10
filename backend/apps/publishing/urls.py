from django.urls import path

from apps.publishing.views import DocumentPublishView, PublicDocumentView

urlpatterns = [
    path("documents/<uuid:document_id>/publish/", DocumentPublishView.as_view(),
         name="document-publish"),
    path("published/<str:public_id>/", PublicDocumentView.as_view(), name="published-document"),
]
